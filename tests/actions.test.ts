/**
 * Writing: signing up, and then changing things as the person who signed up.
 *
 * These run the real server actions against the real database, through the
 * application's own restricted role — so the row-level security policies are
 * in force exactly as they are in production. What is proved here is that a
 * change lands, that it is recorded in the audit trail in the same breath,
 * and that somebody without the access is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** A cookie jar and request headers, since there is no request here. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
}));

/** redirect() throws in Next, and the actions rely on that to stop. */
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

const { signup, login } = await import("../src/app/(auth)/actions");
const { createClient, addBrand, setGrant } = await import("../src/app/(app)/actions/clients");
const { createTask, addNote } = await import("../src/app/(app)/actions/tasks");
const { createEntry } = await import("../src/app/(app)/actions/ledger");
const { createMember } = await import("../src/app/(app)/actions/team");
const { setFeature } = await import("../src/app/(app)/actions/access");
const { getSigned } = await import("../src/lib/auth");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const email = `founder-${suffix}@test.dev`;
let tenantId = "";
let brandId = "";
let clientId = "";

/** Runs a callback as somebody else, by swapping the session cookie. */
async function as(sessionCookie: string, fn: () => Promise<void>) {
  const mine = jar.get("ops_session");
  jar.set("ops_session", sessionCookie);
  try {
    await fn();
  } finally {
    if (mine) jar.set("ops_session", mine);
    else jar.delete("ops_session");
  }
}

beforeAll(async () => {
  await expect(
    signup({ name: "Priya Founder", email, password: "correct horse battery", confirm: "correct horse battery", agree: true }),
  ).rejects.toThrow("redirect:/dashboard");
  const signed = await getSigned();
  tenantId = signed!.tenant.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

describe("signing up", () => {
  test("creates a workspace with the signer as its owner, and signs them in", async () => {
    const signed = await getSigned();
    expect(signed).not.toBeNull();
    expect(signed!.me.isOwner).toBe(true);
    expect(signed!.me.email).toBe(email);
    expect(signed!.tenant.name).toBe("Priya's workspace");
  });

  test("it is usable at once: categories and task departments are there", async () => {
    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t.expenseCategories).toContain("Salaries");
    expect(t.incomeCategories).toContain("Retainer");
    expect(await owner.taskDepartment.count({ where: { tenantId } })).toBe(3);
  });

  test("but nothing is invented: no brands, clients or tasks", async () => {
    expect(await owner.brand.count({ where: { tenantId } })).toBe(0);
    expect(await owner.client.count({ where: { tenantId } })).toBe(0);
    expect(await owner.task.count({ where: { tenantId } })).toBe(0);
  });

  test("the same email cannot start a second workspace", async () => {
    const r = await signup({ name: "Someone Else", email, password: "another password", confirm: "another password", agree: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.email).toMatch(/already uses this email/i);
  });

  test("a wrong password is refused, and so is an unknown address", async () => {
    expect(await login({ email, password: "not it", remember: false })).toMatchObject({ ok: false, errors: { password: expect.any(String) } });
    expect(await login({ email: `nobody-${suffix}@test.dev`, password: "x", remember: false })).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
  });
});

describe("changing things", () => {
  test("a brand, then a client under it", async () => {
    const b = await addBrand({ name: "Northwind" });
    if (!b.ok) throw new Error(b.error);
    brandId = b.data!.id;

    const c = await createClient({ name: "Acme Foods", brand: brandId, retainer: "1,50,000", contact: "Neha", services: "Social" });
    if (!c.ok) throw new Error(c.error);
    clientId = c.data!.id;

    const row = await owner.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(row.retainer).toBe(15_000_000n); // rupees typed with grouping, stored as paise
    // The opening rate is kept as history, so a later change cannot rewrite it.
    expect(await owner.clientRate.count({ where: { clientId } })).toBe(1);
  });

  test("the browser is sent the records that changed, not told to reload", async () => {
    const r = await createTask({ title: "October calendar", brand: brandId, client: clientId, who: (await getSigned())!.me.id, by: (await getSigned())!.me.id, dept: (await owner.taskDepartment.findFirstOrThrow({ where: { tenantId } })).id });
    expect(r.ok).toBe(true);
    expect(r.ok && r.patch?.upsert?.tasks?.[0]).toMatchObject({ title: "October calendar", clientId });
    expect(r.ok && r.patch?.upsert?.audit?.[0]).toMatchObject({ text: "created “October calendar”", target: "Acme Foods" });
  });

  test("money is stored in paise and recorded against the client", async () => {
    const r = await createEntry({ type: "in", desc: "October retainer", client: clientId, cat: "Retainer", amount: "150000", date: "2026-10-03", status: "paid", cur: "INR" });
    expect(r.ok).toBe(true);
    const e = await owner.ledgerEntry.findFirstOrThrow({ where: { tenantId, description: "October retainer" } });
    expect(e.amount).toBe(15_000_000n);
    expect(e.clientId).toBe(clientId);
  });

  test("foreign income keeps both what arrived and what it became", async () => {
    const r = await createEntry({ type: "in", desc: "Overseas fee", client: clientId, cat: "Retainer", amount: "83000", date: "2026-10-03", status: "paid", cur: "USD", orig: "1000" });
    expect(r.ok).toBe(true);
    const e = await owner.ledgerEntry.findFirstOrThrow({ where: { tenantId, description: "Overseas fee" } });
    expect({ amount: e.amount, orig: e.origAmount, cur: e.currency }).toEqual({ amount: 8_300_000n, orig: 100_000n, cur: "USD" });
  });

  test("a refusal explains itself and names the field", async () => {
    const r = await createEntry({ type: "out", desc: "", client: "", cat: "Rent", amount: "-5", date: "2026-10-03", status: "paid", cur: "INR" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.fields).toMatchObject({ desc: expect.any(String) });
  });

  test("every change is in the audit trail, attributed", async () => {
    const rows = await owner.auditEntry.findMany({ where: { tenantId }, orderBy: { at: "asc" } });
    expect(rows.map((a) => a.text)).toEqual([
      "created the workspace",
      "added brand “Northwind”",
      "added client “Acme Foods”",
      "created “October calendar”",
      "added income “October retainer”",
      "added income “Overseas fee”",
    ]);
    expect(new Set(rows.map((a) => a.actorName))).toEqual(new Set(["Priya Founder"]));
  });
});

describe("what someone without the access is told", () => {
  let memberCookie = "";
  let memberId = "";

  beforeAll(async () => {
    const r = await createMember({ name: "Rahul Writer", role: "Content writer", email: `rahul-${suffix}@test.dev` });
    if (!r.ok) throw new Error(r.error);
    memberId = r.data!.id;
    // Sign them in the way the login link would, to act as them.
    await owner.member.update({ where: { id: memberId }, data: { passwordHash: (await owner.member.findUniqueOrThrow({ where: { id: (await getSigned())!.me.id } })).passwordHash } });
    const s = await owner.session.create({ data: { tenantId, memberId, expiresAt: new Date(Date.now() + 864e5) } });
    const { signSession } = await import("../src/lib/session");
    memberCookie = await signSession({ sid: s.id, uid: memberId, tid: tenantId }, 86400);
  }, 60_000);

  test("a new member starts with no reach into any client", async () => {
    expect(await owner.clientGrant.count({ where: { memberId } })).toBe(0);
  });

  test("they cannot add money, and are told why", async () => {
    await as(memberCookie, async () => {
      const r = await createEntry({ type: "out", desc: "Taxi", client: "", cat: "Travel", amount: "500", date: "2026-10-03", status: "paid", cur: "INR" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/access to Expenses/i);
    });
  });

  test("they cannot hand out client access", async () => {
    await as(memberCookie, async () => {
      const r = await setGrant({ memberId, clientId, level: "finance" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/only an owner/i);
    });
    expect(await owner.clientGrant.count({ where: { memberId } })).toBe(0);
  });

  test("they cannot give themselves a section", async () => {
    await as(memberCookie, async () => {
      const r = await setFeature({ memberId, feature: "payroll", level: "edit" });
      expect(r.ok).toBe(false);
    });
    const m = await owner.member.findUniqueOrThrow({ where: { id: memberId } });
    expect((m.features as Record<string, string>).payroll).toBe("none");
  });

  test("a task on a client they cannot reach is refused", async () => {
    await as(memberCookie, async () => {
      const dept = await owner.taskDepartment.findFirstOrThrow({ where: { tenantId } });
      const r = await createTask({ title: "Sneak", brand: brandId, client: clientId, who: memberId, by: memberId, dept: dept.id });
      expect(r.ok).toBe(false);
    });
  });

  test("once granted, the same task is allowed", async () => {
    expect((await setGrant({ memberId, clientId, level: "edit" })).ok).toBe(true);
    await as(memberCookie, async () => {
      const dept = await owner.taskDepartment.findFirstOrThrow({ where: { tenantId } });
      const r = await createTask({ title: "Allowed now", brand: brandId, client: clientId, who: memberId, by: memberId, dept: dept.id });
      expect(r.ok).toBe(true);
    });
  });

  test("the assignee can note on their own task even without Edit on the client", async () => {
    const t = await owner.task.findFirstOrThrow({ where: { tenantId, title: "Allowed now" } });
    await setGrant({ memberId, clientId, level: "view" });
    await as(memberCookie, async () => {
      const r = await addNote({ id: t.id, text: "Draft is at https://docs.example.com/a" });
      expect(r.ok).toBe(true);
    });
    const note = await owner.taskNote.findFirstOrThrow({ where: { taskId: t.id } });
    expect(note.link).toBe("https://docs.example.com/a");
  });
});
