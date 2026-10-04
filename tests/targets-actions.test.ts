/**
 * Targets through the real actions: one per person per month, replaced on a
 * second save, and who may see or set them.
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
const { setTarget, removeTarget } = await import("../src/app/(app)/actions/targets");
const { signSession, SESSION_COOKIE } = await import("../src/lib/session");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const ym = new Date().toISOString().slice(0, 7);
let tenantId = "";
let meId = "";
let nehaId = "";

beforeAll(async () => {
  await expect(
    signup({ name: "Priya Founder", email: `founder-tg-${suffix}@test.dev`, password: "correct horse battery", confirm: "correct horse battery", agree: true }),
  ).rejects.toThrow("redirect:/dashboard");
  const signed = (await getSigned())!;
  tenantId = signed.tenant.id;
  meId = signed.me.id;
  const m = await createMember({ name: "Neha Seller", role: "Sales", email: `neha-tg-${suffix}@test.dev` });
  if (!m.ok) throw new Error(m.error);
  nehaId = m.data!.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

const as = async <T>(memberId: string, fn: () => Promise<T>): Promise<T> => {
  const me = await owner.member.findUniqueOrThrow({ where: { id: meId } });
  await owner.member.update({ where: { id: memberId }, data: { passwordHash: me.passwordHash } });
  const session = await owner.session.create({ data: { tenantId, memberId, expiresAt: new Date(Date.now() + 864e5) } });
  const mine = jar.get(SESSION_COOKIE);
  jar.set(SESSION_COOKIE, await signSession({ sid: session.id, uid: memberId, tid: tenantId }, 3600));
  try {
    return await fn();
  } finally {
    if (mine) jar.set(SESSION_COOKIE, mine);
  }
};

describe("setting targets", () => {
  test("a team target and a person's, side by side", async () => {
    expect((await setTarget({ memberId: "", month: ym, sales: "30", amount: "500000" })).ok).toBe(true);
    expect((await setTarget({ memberId: nehaId, month: ym, sales: "", amount: "", dailySales: "1", dailyAmount: "5000" })).ok).toBe(true);
    const rows = await owner.target.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.memberId === null)).toMatchObject({ sales: 30, amount: 50_000_000n, dailySales: null });
    expect(rows.find((r) => r.memberId === nehaId)).toMatchObject({ sales: null, dailySales: 1, dailyAmount: 500_000n });
  });

  test("saving again for the same month replaces, never duplicates", async () => {
    expect((await setTarget({ memberId: "", month: ym, sales: "40", amount: "" })).ok).toBe(true);
    const team = await owner.target.findMany({ where: { tenantId, memberId: null } });
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ sales: 40, amount: null });
  });

  test("the database itself allows one team target per month", async () => {
    const month = new Date(`${ym}-01T00:00:00.000Z`);
    await expect(owner.target.create({ data: { tenantId, memberId: null, month, sales: 1, createdById: meId } })).rejects.toThrow();
  });

  test("refuses an empty target, a fraction of a sale, or a negative amount", async () => {
    expect((await setTarget({ memberId: "", month: ym })).ok).toBe(false);
    expect((await setTarget({ memberId: "", month: ym, sales: "2.5" })).ok).toBe(false);
    expect((await setTarget({ memberId: "", month: ym, amount: "-1" })).ok).toBe(false);
  });

  test("is written to the audit trail", async () => {
    const a = await owner.auditEntry.findFirst({ where: { tenantId, area: "targets" }, orderBy: { at: "desc" } });
    expect(a?.text).toMatch(/target for the team/);
  });
});

describe("who sees and sets them", () => {
  test("an owner's workspace carries them", async () => {
    const w = await loadWorkspace((await getSigned())!);
    expect(w.targets.map((t) => t.memberId).sort()).toEqual([nehaId, null].sort());
  });

  test("somebody without the Targets section neither sees nor sets one", async () => {
    await as(nehaId, async () => {
      const w = await loadWorkspace((await getSigned())!);
      expect(w.targets).toEqual([]);
      const r = await setTarget({ memberId: nehaId, month: ym, sales: "100" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/session has ended/);
    });
  });

  test("Targets view sees them and still cannot set one", async () => {
    await owner.member.update({ where: { id: nehaId }, data: { features: { targets: "view" } } });
    await as(nehaId, async () => {
      const w = await loadWorkspace((await getSigned())!);
      expect(w.targets).toHaveLength(2);
      expect((await setTarget({ memberId: nehaId, month: ym, sales: "100" })).ok).toBe(false);
    });
  });

  test("removing one", async () => {
    const t = await owner.target.findFirstOrThrow({ where: { tenantId, memberId: nehaId } });
    expect((await removeTarget(t.id)).ok).toBe(true);
    expect(await owner.target.count({ where: { tenantId } })).toBe(1);
  });
});
