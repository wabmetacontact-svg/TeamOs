/**
 * Commission against the real database, through the real actions.
 *
 * The arithmetic has its own tests (tests/commission.test.ts). These are about
 * the money moving: what paying writes to the ledger, that paying twice pays
 * nothing, that money arriving after a payment becomes a balance rather than
 * being lost or paid again, and who may see a rate at all.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
}));
class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { signup } = await import("../src/app/(auth)/actions");
const { getSigned } = await import("../src/lib/auth");
const { loadWorkspace } = await import("../src/lib/workspace");
const { addBrand, createClient } = await import("../src/app/(app)/actions/clients");
const { createMember } = await import("../src/app/(app)/actions/team");
const { saveCommissionRate, payCommission, addCommissionRule, removeCommissionRule, setCommissionSkip } = await import(
  "../src/app/(app)/actions/commission"
);
const { signSession, SESSION_COOKIE } = await import("../src/lib/session");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const ym = new Date().toISOString().slice(0, 7);
const day = (d: string) => new Date(`${ym}-${d}T00:00:00.000Z`);
let tenantId = "";
let meId = "";
let raviId = "";
let clientId = "";

const income = (amountPaise: number, over: Record<string, unknown> = {}) =>
  owner.ledgerEntry.create({
    data: {
      tenantId,
      type: "in",
      date: day("05"),
      description: "Plan payment",
      category: "WabMeta plan",
      amount: BigInt(amountPaise),
      status: "paid",
      clientId,
      createdById: meId,
      ...over,
    },
  });

const commissionsPaid = () =>
  owner.ledgerEntry.findMany({ where: { tenantId, category: "Commissions", memberId: raviId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await expect(
    signup({ name: "Priya Founder", email: `founder-cm-${suffix}@test.dev`, password: "correct horse battery", confirm: "correct horse battery", agree: true }),
  ).rejects.toThrow("redirect:/dashboard");
  const signed = (await getSigned())!;
  tenantId = signed.tenant.id;
  meId = signed.me.id;

  const m = await createMember({ name: "Ravi Sales", role: "Sales", email: `ravi-${suffix}@test.dev` });
  if (!m.ok) throw new Error(m.error);
  raviId = m.data!.id;

  const b = await addBrand({ name: `Brand ${suffix}` });
  if (!b.ok) throw new Error(b.error);
  const c = await createClient({ name: `Ravi's Client ${suffix}`, brand: b.data!.id });
  if (!c.ok) throw new Error(c.error);
  clientId = c.data!.id;
  // Credited to Ravi, the way the WabMeta sync credits a seller.
  await owner.client.update({ where: { id: clientId }, data: { ownerMemberId: raviId } });
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

describe("a rate", () => {
  test("is refused outside 0 to 100", async () => {
    const r = await saveCommissionRate({ memberId: raviId, pct: "150", from: `${ym}-01` });
    expect(r.ok).toBe(false);
  });

  test("is saved as history, in basis points", async () => {
    const r = await saveCommissionRate({ memberId: raviId, pct: "10", from: `${ym}-01` });
    expect(r.ok).toBe(true);
    const rows = await owner.commissionRate.findMany({ where: { tenantId, memberId: raviId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bps).toBe(1000);
  });
});

describe("paying", () => {
  test("pays the rate on what their client paid, into expenses", async () => {
    await income(179_900);
    const r = await payCommission({ memberId: raviId, ym });
    expect(r.ok).toBe(true);
    const paid = await commissionsPaid();
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ type: "out", status: "paid", amount: 17_990n, category: "Commissions" });

    // The category exists, so the expense screens and reports can group by it.
    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t.expenseCategories).toContain("Commissions");
  });

  test("paying again pays nothing", async () => {
    const r = await payCommission({ memberId: raviId, ym });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already paid/);
    expect(await commissionsPaid()).toHaveLength(1);
  });

  test("money that arrives after the payment becomes a balance, not a second full payment", async () => {
    await income(50_000, { date: day("20") });
    const r = await payCommission({ memberId: raviId, ym });
    expect(r.ok).toBe(true);
    const paid = await commissionsPaid();
    expect(paid).toHaveLength(2);
    expect(paid[1]!.amount).toBe(5_000n);
    expect(paid[1]!.description).toMatch(/balance/);
    // In all: 10% of 2,29,900 paise, exactly once.
    expect(paid.reduce((a, e) => a + e.amount, 0n)).toBe(22_990n);
  });

  test("pending money earns nothing until it is paid", async () => {
    await income(1_000_000, { status: "pending" });
    const r = await payCommission({ memberId: raviId, ym });
    expect(r.ok).toBe(false);
  });
});

describe("what earns commission", () => {
  test("a skipped category earns nothing", async () => {
    await owner.tenant.update({ where: { id: tenantId }, data: { incomeCategories: { push: "WabMeta wallet" } } });
    const s = await setCommissionSkip({ categories: ["WabMeta wallet", "Not a real category"] });
    expect(s.ok).toBe(true);
    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    // Unknown categories are dropped rather than stored.
    expect(t.commissionSkip).toEqual(["WabMeta wallet"]);

    await income(10_000_000, { category: "WabMeta wallet" });
    const r = await payCommission({ memberId: raviId, ym });
    expect(r.ok).toBe(false);
  });
});

describe("commission by hand", () => {
  test("a percentage needs a client", async () => {
    const r = await addCommissionRule({ memberId: raviId, kind: "percent", value: "5", fromMonth: ym });
    expect(r.ok).toBe(false);
  });

  test("a fixed amount is paid on top of the automatic commission", async () => {
    const r = await addCommissionRule({ memberId: raviId, kind: "fixed", value: "500", fromMonth: ym, note: "Onboarding bonus" });
    expect(r.ok).toBe(true);
    const pay = await payCommission({ memberId: raviId, ym });
    expect(pay.ok).toBe(true);
    const paid = await commissionsPaid();
    expect(paid[paid.length - 1]!.amount).toBe(50_000n);
  });

  test("can be given to somebody who brought nothing in", async () => {
    const r = await addCommissionRule({ memberId: meId, kind: "percent", value: "5", clientId, repeat: "monthly", fromMonth: ym });
    expect(r.ok).toBe(true);
    const pay = await payCommission({ memberId: meId, ym });
    expect(pay.ok).toBe(true);
    const mine = await owner.ledgerEntry.findFirstOrThrow({ where: { tenantId, category: "Commissions", memberId: meId } });
    // 5% of the plan money (2,29,900); not of the wallet top-up, which is skipped.
    expect(mine.amount).toBe(11_495n);
  });

  test("removing one stops it counting, and leaves what was paid alone", async () => {
    const rule = await owner.commissionRule.findFirstOrThrow({ where: { tenantId, memberId: raviId } });
    const before = await commissionsPaid();
    const r = await removeCommissionRule(rule.id);
    expect(r.ok).toBe(true);
    expect(await owner.commissionRule.count({ where: { id: rule.id } })).toBe(0);
    expect(await commissionsPaid()).toHaveLength(before.length);
  });
});

describe("who sees it", () => {
  test("an owner's workspace carries rates and commissions", async () => {
    const w = await loadWorkspace((await getSigned())!);
    expect(w.commissionRates.some((r) => r.memberId === raviId && r.bps === 1000)).toBe(true);
    expect(w.commissionRules.length).toBeGreaterThan(0);
  });

  test("somebody without Payroll gets neither, and cannot pay or set one", async () => {
    const me = await owner.member.findUniqueOrThrow({ where: { id: meId } });
    await owner.member.update({ where: { id: raviId }, data: { passwordHash: me.passwordHash } });
    const session = await owner.session.create({ data: { tenantId, memberId: raviId, expiresAt: new Date(Date.now() + 864e5) } });
    const mine = jar.get(SESSION_COOKIE);
    jar.set(SESSION_COOKIE, await signSession({ sid: session.id, uid: raviId, tid: tenantId }, 3600));
    try {
      const w = await loadWorkspace((await getSigned())!);
      expect(w.commissionRates).toEqual([]);
      expect(w.commissionRules).toEqual([]);

      // Not even their own: what someone is paid is set by Payroll.
      const r = await saveCommissionRate({ memberId: raviId, pct: "50", from: `${ym}-01` });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/session has ended/);
      const p = await payCommission({ memberId: raviId, ym });
      expect(p.ok).toBe(false);
    } finally {
      if (mine) jar.set(SESSION_COOKIE, mine);
    }
  });
});
