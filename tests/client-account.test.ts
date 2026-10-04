/**
 * A client's account details and the password vault.
 *
 * What matters most here is what does NOT happen: the password never reaches
 * the workspace that every page load sends to the browser, a member who is
 * not an owner cannot read it, and the audit trail records that it was viewed
 * without recording what it was.
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

const { open, seal, vaultReady } = await import("../src/lib/vault");
const { signup } = await import("../src/app/(auth)/actions");
const { getSigned } = await import("../src/lib/auth");
const { loadWorkspace } = await import("../src/lib/workspace");
const { addBrand, createClient, editClient, saveClientAccount, setClientPassword, revealClientPassword, clearClientPassword } =
  await import("../src/app/(app)/actions/clients");
const { createMember } = await import("../src/app/(app)/actions/team");
const { signSession, SESSION_COOKIE } = await import("../src/lib/session");

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const SECRET = `Hunter2-${suffix}`;
let tenantId = "";
let clientId = "";
let syncedId = "";

// ───────────────────────────────────────────────────────────── the vault ───

describe("the vault", () => {
  test("is configured for this run", () => {
    expect(vaultReady()).toBe(true);
  });

  test("encrypts to something that is not the password, and back", () => {
    const sealed = seal("correct horse");
    expect(sealed).not.toContain("correct horse");
    expect(open(sealed)).toBe("correct horse");
  });

  test("encrypts the same password differently each time", () => {
    // A fresh IV per value: two clients with the same password must not be
    // recognisable as such from the database.
    expect(seal("same")).not.toBe(seal("same"));
  });

  test("refuses a stored value that was tampered with, rather than returning garbage", () => {
    const [v, iv, tag, body] = seal("secret").split(":");
    const flipped = Buffer.from(body!, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  test("says it is not ready without a key, instead of throwing", () => {
    const k = process.env.CLIENT_VAULT_KEY;
    delete process.env.CLIENT_VAULT_KEY;
    try {
      expect(vaultReady()).toBe(false);
      expect(() => seal("x")).toThrow(/CLIENT_VAULT_KEY/);
    } finally {
      process.env.CLIENT_VAULT_KEY = k;
    }
  });
});

// ─────────────────────────────────────────────────────── with the database ───

beforeAll(async () => {
  await expect(
    signup({
      name: "Priya Founder",
      email: `founder-ca-${suffix}@test.dev`,
      password: "correct horse battery",
      confirm: "correct horse battery",
      agree: true,
    }),
  ).rejects.toThrow("redirect:/dashboard");
  const signed = (await getSigned())!;
  tenantId = signed.tenant.id;

  const brand = await addBrand({ name: `Brand ${suffix}` });
  expect(brand.ok).toBe(true);
  const created = await createClient({ name: `Manual Co ${suffix}`, brand: brand.ok ? brand.data!.id : "" });
  expect(created.ok).toBe(true);
  clientId = created.ok ? created.data!.id : "";

  // A client as the WabMeta sync leaves it.
  const synced = await owner.client.create({
    data: {
      tenantId,
      brandId: brand.ok ? brand.data!.id : "",
      name: "Synced Co",
      company: "Synced Co",
      contact: "owner@synced.test",
      externalSource: "wabmeta",
      externalId: `org:abc-${suffix}`,
      loginId: "owner@synced.test",
      plan: "Growth",
    },
  });
  syncedId = synced.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

describe("account details", () => {
  test("a client added here takes a login, a phone and notes", async () => {
    const r = await saveClientAccount({ id: clientId, details: "Prefers calls after 4", loginId: "manual@co.test", phone: "+91 98765 43210" });
    expect(r.ok).toBe(true);
    const row = await owner.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(row).toMatchObject({ details: "Prefers calls after 4", loginId: "manual@co.test", phone: "+91 98765 43210" });
  });

  test("a synced client takes notes, but keeps the login WabMeta gave it", async () => {
    // The sync would put the login back on its next pass; accepting the edit
    // would only make it look as though it worked.
    const r = await saveClientAccount({ id: syncedId, details: "VIP", loginId: "changed@here.test", phone: "1" });
    expect(r.ok).toBe(true);
    const row = await owner.client.findUniqueOrThrow({ where: { id: syncedId } });
    expect(row.details).toBe("VIP");
    expect(row.loginId).toBe("owner@synced.test");
    expect(row.phone).toBe("");
  });

  test("editing a synced client's profile keeps its WabMeta fields", async () => {
    const brandId = (await owner.client.findUniqueOrThrow({ where: { id: syncedId } })).brandId;
    const r = await editClient({
      id: syncedId,
      name: "Renamed Here",
      company: "Renamed Ltd",
      brand: brandId,
      contact: "someone else",
      services: "WhatsApp marketing",
      payDay: "5",
    });
    expect(r.ok).toBe(true);
    const row = await owner.client.findUniqueOrThrow({ where: { id: syncedId } });
    expect(row.name).toBe("Synced Co");
    expect(row.contact).toBe("owner@synced.test");
    // ...while the fields TeamOS owns do save.
    expect(row.services).toBe("WhatsApp marketing");
    expect(row.payDay).toBe(5);
  });

  test("the workspace says which clients are synced, and the WabMeta id", async () => {
    const w = await loadWorkspace((await getSigned())!);
    const s = w.clients.find((c) => c.id === syncedId)!;
    expect(s.synced).toBe(true);
    expect(s.wabmetaId).toBe(`abc-${suffix}`);
    expect(s.plan).toBe("Growth");
    expect(w.clients.find((c) => c.id === clientId)!.synced).toBe(false);
  });
});

describe("the password", () => {
  test("an owner stores it, and it is encrypted in the database", async () => {
    const r = await setClientPassword({ id: clientId, password: SECRET });
    expect(r.ok).toBe(true);
    const row = await owner.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(row.passwordEnc).toBeTruthy();
    expect(row.passwordEnc).not.toContain(SECRET);
    expect(row.passwordSetAt).not.toBeNull();
  });

  test("never travels with the workspace - not the password, not the ciphertext", async () => {
    const w = await loadWorkspace((await getSigned())!);
    const json = JSON.stringify(w);
    expect(json).not.toContain(SECRET);
    const row = await owner.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(json).not.toContain(row.passwordEnc!);
    expect(w.clients.find((c) => c.id === clientId)!.hasPassword).toBe(true);
  });

  test("an owner can read it back", async () => {
    const r = await revealClientPassword(clientId);
    expect(r.ok && r.data?.password).toBe(SECRET);
  });

  test("viewing it is in the audit trail, and the password is not", async () => {
    const entries = await owner.auditEntry.findMany({ where: { tenantId, clientId } });
    expect(entries.some((e) => /viewed the login password/.test(e.text))).toBe(true);
    expect(entries.some((e) => /stored a login password/.test(e.text))).toBe(true);
    const all = JSON.stringify(entries);
    expect(all).not.toContain(SECRET);
  });

  test("somebody who is not an owner can neither read nor change it", async () => {
    const m = await createMember({ name: "Rahul Writer", role: "Writer", email: `rahul-${suffix}@test.dev` });
    if (!m.ok) throw new Error(m.error);
    // Able to sign in, the way a login link would leave them - otherwise the
    // refusal below would be "your session has ended" and prove nothing.
    const me = await owner.member.findUniqueOrThrow({ where: { id: (await getSigned())!.me.id } });
    const member = await owner.member.update({ where: { id: m.data!.id }, data: { passwordHash: me.passwordHash } });
    // Even with Edit on this client: the password is an owner's, not a grant's.
    await owner.clientGrant.create({ data: { tenantId, memberId: member.id, clientId, level: "edit" } });
    const session = await owner.session.create({ data: { tenantId, memberId: member.id, expiresAt: new Date(Date.now() + 864e5) } });

    const mine = jar.get(SESSION_COOKIE);
    jar.set(SESSION_COOKIE, await signSession({ sid: session.id, uid: member.id, tid: tenantId }, 3600));
    try {
      const read = await revealClientPassword(clientId);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.error).toMatch(/Only an owner/);
      expect(read.ok ? read.data : undefined).toBeUndefined();

      const write = await setClientPassword({ id: clientId, password: "overwritten" });
      expect(write.ok).toBe(false);
      expect(open((await owner.client.findUniqueOrThrow({ where: { id: clientId } })).passwordEnc!)).toBe(SECRET);

      const clear = await clearClientPassword(clientId);
      expect(clear.ok).toBe(false);
    } finally {
      if (mine) jar.set(SESSION_COOKIE, mine);
    }
  });

  test("an owner can remove it", async () => {
    const r = await clearClientPassword(clientId);
    expect(r.ok).toBe(true);
    const row = await owner.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(row.passwordEnc).toBeNull();
  });
});
