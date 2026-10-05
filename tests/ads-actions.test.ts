/**
 * Ad spend through the real actions: the expense it writes, removing both
 * together, and who may see it.
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
const { createMember } = await import("../src/app/(app)/actions/team");
const { addAdSpend, removeAdSpend } = await import("../src/app/(app)/actions/ads");
const { signSession, SESSION_COOKIE } = await import("../src/lib/session");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const ym = new Date().toISOString().slice(0, 7);
let tenantId = "";
let meId = "";
let nehaId = "";

beforeAll(async () => {
  await expect(
    signup({ name: "Priya Founder", email: `founder-ad-${suffix}@test.dev`, password: "correct horse battery", confirm: "correct horse battery", agree: true }),
  ).rejects.toThrow("redirect:/dashboard");
  const signed = (await getSigned())!;
  tenantId = signed.tenant.id;
  meId = signed.me.id;
  const m = await createMember({ name: "Neha Onboarder", role: "Onboarder", email: `neha-${suffix}@test.dev` });
  if (!m.ok) throw new Error(m.error);
  nehaId = m.data!.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

describe("recording ads", () => {
  let spendId = "";

  test("writes the spend and an expense under Ads, together", async () => {
    const r = await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "15000", leads: "60", note: "Meta - Diwali" });
    expect(r.ok).toBe(true);
    const row = await owner.adSpend.findFirstOrThrow({ where: { tenantId, memberId: nehaId } });
    spendId = row.id;
    expect(row).toMatchObject({ amount: 1_500_000n, leads: 60 });
    expect(row.ledgerEntryId).toBeTruthy();

    const entry = await owner.ledgerEntry.findUniqueOrThrow({ where: { id: row.ledgerEntryId! } });
    expect(entry).toMatchObject({ type: "out", category: "Ads", amount: 1_500_000n, status: "paid", memberId: nehaId, clientId: null });
    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t.expenseCategories).toContain("Ads");
  });

  test("leads that cost nothing are recorded without an expense", async () => {
    const r = await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "", leads: "12", note: "Referrals" });
    expect(r.ok).toBe(true);
    const row = await owner.adSpend.findFirstOrThrow({ where: { tenantId, memberId: nehaId, leads: 12 } });
    expect(row.amount).toBe(0n);
    expect(row.ledgerEntryId).toBeNull();
  });

  test("refuses an entry with neither spend nor leads, or a negative one", async () => {
    expect((await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "", leads: "" })).ok).toBe(false);
    expect((await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "-5", leads: "1" })).ok).toBe(false);
    expect((await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "10", leads: "1.5" })).ok).toBe(false);
  });

  test("removing it removes its expense too", async () => {
    const row = await owner.adSpend.findUniqueOrThrow({ where: { id: spendId } });
    const r = await removeAdSpend(spendId);
    expect(r.ok).toBe(true);
    expect(await owner.adSpend.count({ where: { id: spendId } })).toBe(0);
    expect(await owner.ledgerEntry.count({ where: { id: row.ledgerEntryId! } })).toBe(0);
  });
});

describe("a day or a week", () => {
  test("a week runs Monday to Sunday, from any day in it, and its expense is dated on the Monday", async () => {
    // 7 Oct 2026 is a Wednesday.
    const r = await addAdSpend({ memberId: nehaId, period: "week", date: "2026-10-07", amount: "7000", leads: "70", note: "Week test" });
    expect(r.ok).toBe(true);
    const row = await owner.adSpend.findFirstOrThrow({ where: { tenantId, note: "Week test" } });
    expect(row.period).toBe("week");
    expect(row.fromDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(row.toDate.toISOString().slice(0, 10)).toBe("2026-10-11");
    const entry = await owner.ledgerEntry.findUniqueOrThrow({ where: { id: row.ledgerEntryId! } });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(entry.description).toContain("Week of 5 Oct 2026");
  });

  test("a day is that day", async () => {
    const r = await addAdSpend({ memberId: nehaId, period: "day", date: "2026-10-09", amount: "500", leads: "4", note: "Day test" });
    expect(r.ok).toBe(true);
    const row = await owner.adSpend.findFirstOrThrow({ where: { tenantId, note: "Day test" } });
    expect(row.fromDate.toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(row.toDate.toISOString().slice(0, 10)).toBe("2026-10-09");
  });

  test("a month covers the whole month", async () => {
    const row = await owner.adSpend.findFirstOrThrow({ where: { tenantId, note: "Referrals" } });
    expect(row.period).toBe("month");
    expect(row.fromDate.toISOString().slice(0, 10)).toBe(`${ym}-01`);
    expect(row.toDate.toISOString().slice(5, 7)).toBe(ym.slice(5, 7));
  });
});

describe("who sees it", () => {
  test("an owner's workspace carries it", async () => {
    const w = await loadWorkspace((await getSigned())!);
    expect(w.adSpends.some((s) => s.memberId === nehaId && s.leads === 12)).toBe(true);
  });

  test("somebody without the Ads section neither sees nor records it", async () => {
    const me = await owner.member.findUniqueOrThrow({ where: { id: meId } });
    await owner.member.update({ where: { id: nehaId }, data: { passwordHash: me.passwordHash } });
    const session = await owner.session.create({ data: { tenantId, memberId: nehaId, expiresAt: new Date(Date.now() + 864e5) } });
    const mine = jar.get(SESSION_COOKIE);
    jar.set(SESSION_COOKIE, await signSession({ sid: session.id, uid: nehaId, tid: tenantId }, 3600));
    try {
      const w = await loadWorkspace((await getSigned())!);
      expect(w.adSpends).toEqual([]);
      const r = await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "100", leads: "1" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/session has ended/);
    } finally {
      if (mine) jar.set(SESSION_COOKIE, mine);
    }
  });

  test("Ads view shows the figures without Expenses, and still cannot record", async () => {
    // The section is its own grant now: somebody can be shown how ads are doing
    // without being handed the whole ledger.
    await owner.member.update({ where: { id: nehaId }, data: { features: { ads: "view" } } });
    const session = await owner.session.create({ data: { tenantId, memberId: nehaId, expiresAt: new Date(Date.now() + 864e5) } });
    const mine = jar.get(SESSION_COOKIE);
    jar.set(SESSION_COOKIE, await signSession({ sid: session.id, uid: nehaId, tid: tenantId }, 3600));
    try {
      const w = await loadWorkspace((await getSigned())!);
      expect(w.adSpends.some((s) => s.leads === 12)).toBe(true);
      const r = await addAdSpend({ memberId: nehaId, period: "month", date: `${ym}-01`, amount: "100", leads: "1" });
      expect(r.ok).toBe(false);
    } finally {
      if (mine) jar.set(SESSION_COOKIE, mine);
    }
  });
});
