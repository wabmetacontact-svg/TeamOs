/**
 * Importing earlier data through the real action: clients with the people
 * credited, money not counted twice, and past ad spend.
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
const { createMember } = await import("../src/app/(app)/actions/team");
const { runImport } = await import("../src/app/(app)/actions/imports");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
let tenantId = "";
let anilId = "";
let nehaId = "";

beforeAll(async () => {
  await expect(
    signup({ name: "Priya Founder", email: `founder-im-${suffix}@test.dev`, password: "correct horse battery", confirm: "correct horse battery", agree: true }),
  ).rejects.toThrow("redirect:/dashboard");
  tenantId = (await getSigned())!.tenant.id;
  for (const [name, role] of [["Anil Sales", "Sales"], ["Neha Onboarder", "Onboarder"]] as const) {
    const m = await createMember({ name, role, email: `${name.split(" ")[0]!.toLowerCase()}-im-${suffix}@test.dev` });
    if (!m.ok) throw new Error(m.error);
    if (name.startsWith("Anil")) anilId = m.data!.id;
    else nehaId = m.data!.id;
  }
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

describe("importing earlier data", () => {
  test("clients with who sold and who onboarded them, and their account", async () => {
    const r = await runImport({
      type: "clients",
      fileName: "old-clients.xlsx",
      rows: [
        ["Muthu Traders", "anil", "Neha Onboarder", "muthu@mail.in", "+91 90000 00001", "2026-08-12"],
        ["Sri Agencies", "Anil Sales", "", "", "", "12/08/2026"],
      ],
      map: { name: "0", seller: "1", onboarder: "2", login: "3", phone: "4", since: "5" },
    });
    expect(r.ok).toBe(true);
    const muthu = await owner.client.findFirstOrThrow({ where: { tenantId, name: "Muthu Traders" } });
    expect(muthu).toMatchObject({ ownerMemberId: anilId, onboarderMemberId: nehaId, loginId: "muthu@mail.in", phone: "+91 90000 00001" });
    expect(muthu.sinceDate!.toISOString().slice(0, 10)).toBe("2026-08-12");
    // The people credited can open the client, as the WabMeta sync arranges.
    const grants = await owner.clientGrant.findMany({ where: { clientId: muthu.id } });
    expect(grants.map((g) => g.memberId).sort()).toEqual([anilId, nehaId].sort());
  });

  test("payments imported twice are counted once", async () => {
    const rows = [
      ["2026-08-15", "Plan, Muthu", "8999", "Income", "Muthu Traders", "Anil Sales"],
      ["2026-09-15", "Plan, Muthu", "8999", "Income", "Muthu Traders", "Anil Sales"],
    ];
    const map = { date: "0", desc: "1", amount: "2", type: "3", client: "4", member: "5" };
    const first = await runImport({ type: "ledger", fileName: "payments.csv", rows, map });
    expect(first.ok && first.data!.n).toBe(2);
    const again = await runImport({ type: "ledger", fileName: "payments.csv", rows, map });
    expect(again.ok).toBe(false);
    const entries = await owner.ledgerEntry.findMany({ where: { tenantId, description: "Plan, Muthu" } });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.memberId === anilId && e.amount === 899_900n)).toBe(true);
  });

  test("past ad spend becomes an expense in its month, once", async () => {
    const rows = [["Anil", "Aug 2026", "12900", "310", "Meta"]];
    const map = { who: "0", month: "1", amount: "2", leads: "3", note: "4" };
    const r = await runImport({ type: "ads", fileName: "ads.csv", rows, map });
    expect(r.ok).toBe(true);
    const spend = await owner.adSpend.findFirstOrThrow({ where: { tenantId, memberId: anilId } });
    expect(spend).toMatchObject({ amount: 1_290_000n, leads: 310, note: "Meta" });
    const expense = await owner.ledgerEntry.findUniqueOrThrow({ where: { id: spend.ledgerEntryId! } });
    expect(expense).toMatchObject({ type: "out", category: "Ads", amount: 1_290_000n, memberId: anilId });
    expect(expense.date.toISOString().slice(0, 10)).toBe("2026-08-28");
    expect((await runImport({ type: "ads", fileName: "ads.csv", rows, map })).ok).toBe(false);
    expect(await owner.adSpend.count({ where: { tenantId } })).toBe(1);
  });
});
