/**
 * Signing in, run as the application actually runs.
 *
 * This file exists because of a bug that reached a browser. Every auth query
 * was written on the raw Prisma client, which is subject to row-level security
 * and had no tenant set — so `user.findFirst({ email })` returned null for
 * every account that existed, and every login was refused as "wrong email or
 * password". The message for a wrong password and for an invisible row is the
 * same by design, so nothing about the failure pointed at the cause.
 *
 * The whole suite was green while this was true, because every other test
 * builds a Scope by hand and never signs in. So these tests connect as
 * `teamos_app` — the role the application uses, with no BYPASSRLS — and do the
 * reads the login path does, in its order.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { tenantDb } from "../src/lib/db";
import { hashPassword, resolveLoginTenants, verifyPassword } from "../src/lib/auth";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
/** No BYPASSRLS. What the application can actually see. */
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const suffix = Date.now().toString(36);
const email = `login-${suffix}@test.dev`;
const password = "a-password-long-enough";

let tenantId: string;
let userId: string;
let sessionId: string;

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Login ${suffix}`, slug: `login-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Owner", description: "Test" } });
    const user = await tx.user.create({
      data: { tenantId, email, name: "Tester", passwordHash: await hashPassword(password), roleId: role.id, allClients: true },
    });
    userId = user.id;

    const session = await tx.session.create({
      data: {
        tenantId,
        userId: user.id,
        refreshTokenHash: `hash-${suffix}`,
        family: `family-${suffix}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    sessionId = session.id;
  });
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `login-${suffix}` } });
  });
  await owner.$disconnect();
  await app.$disconnect();
});

describe("the ordering problem", () => {
  test("the raw client cannot see a user by email — which is the bug", async () => {
    // Kept as a test rather than deleted, because it is the thing that must
    // stay true: without a tenant, nothing is visible. The fix is not to
    // weaken this; it is to establish a tenant first.
    expect(await app.user.findFirst({ where: { email } })).toBeNull();
    expect(await owner.user.findFirst({ where: { email } })).not.toBeNull();
  });

  test("the resolver finds the workspace an email belongs to", async () => {
    const found = await resolveLoginTenants(email);
    expect(found.map((w) => w.tenantId)).toEqual([tenantId]);
    expect(found[0]!.name).toBe(`Login ${suffix}`);

    // Case and stray whitespace are what people actually type.
    expect((await resolveLoginTenants(email.toUpperCase()))[0]?.tenantId).toBe(tenantId);
    expect((await resolveLoginTenants(`  ${email}  `))[0]?.tenantId).toBe(tenantId);
  });

  test("it returns nothing for an address nobody uses", async () => {
    expect(await resolveLoginTenants("nobody@example.com")).toEqual([]);
    expect(await resolveLoginTenants("")).toEqual([]);
    expect(await resolveLoginTenants("   ")).toEqual([]);
  });

  test("it returns ids and names, and nothing else", async () => {
    const rows = await app.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM auth_tenants_for_email(${email})
    `;
    // Three columns, all of them safe to show on a picker. Not the user row,
    // not the password hash, not who else is in the workspace.
    expect(Object.keys(rows[0]!).sort()).toEqual(["tenant_id", "tenant_name", "tenant_slug"]);
    expect(rows[0]!.tenant_id).toBe(tenantId);
  });

  test("a suspended workspace cannot be signed into at all", async () => {
    await owner.tenant.update({ where: { id: tenantId }, data: { status: "Suspended" } });
    // Refused at the resolver, before a password is even compared.
    expect(await resolveLoginTenants(email)).toEqual([]);

    await owner.tenant.update({ where: { id: tenantId }, data: { status: "Active" } });
    expect((await resolveLoginTenants(email))[0]?.tenantId).toBe(tenantId);
  });

  test("a deactivated account cannot sign in either", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: userId }, data: { status: "Deactivated" } });
    });

    // Refused here as well as later, so a deactivated account does not even
    // reach the password comparison.
    expect(await resolveLoginTenants(email)).toEqual([]);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: userId }, data: { status: "Active" } });
    });
  });
});

describe("the login path, in its order", () => {
  test("resolve, then read, then verify — and the password matches", async () => {
    const [workspace] = await resolveLoginTenants(email);
    expect(workspace?.tenantId).toBe(tenantId);

    const user = await tenantDb(workspace!.tenantId).user.findFirst({
      where: { email },
      include: { tenant: { select: { id: true, status: true } } },
    });

    // The step that returned null before the fix.
    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);

    const { ok } = await verifyPassword(user!.passwordHash, password);
    expect(ok).toBe(true);
  });

  test("a wrong password fails on the same path", async () => {
    const [workspace] = await resolveLoginTenants(email);
    const user = await tenantDb(workspace!.tenantId).user.findUniqueOrThrow({ where: { id: userId } });

    expect((await verifyPassword(user.passwordHash, "not the password")).ok).toBe(false);
  });

  test("a bcrypt account still verifies, and asks to be upgraded", async () => {
    // The accounts carried over from the previous application are bcrypt, and
    // must keep working without anybody being told to reset a password they
    // still know. Hashed here rather than pasted, so the test cannot pass on a
    // hash that happens to be wrong.
    const bcryptHash = await bcrypt.hash("carried over from the old app", 10);

    const { ok, needsUpgrade } = await verifyPassword(bcryptHash, "carried over from the old app");
    expect(ok).toBe(true);
    // True is what triggers the silent upgrade to argon2 on sign-in.
    expect(needsUpgrade).toBe(true);

    const wrong = await verifyPassword(bcryptHash, "something else");
    expect(wrong.ok).toBe(false);
    expect(wrong.needsUpgrade).toBe(false);
  });
});

describe("resolving a scope afterwards", () => {
  test("the session read needs its tenant too", async () => {
    // getScope() reads this on every request. Unbound it returns nothing, so
    // a login that somehow succeeded would still land on the login page.
    expect(await app.session.findFirst({ where: { id: sessionId } })).toBeNull();

    const bound = await tenantDb(tenantId).session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(bound).not.toBeNull();
  });

  test("a revoked session stops resolving, bound the same way", async () => {
    await tenantDb(tenantId).session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

    expect(
      await tenantDb(tenantId).session.findFirst({
        where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBeNull();

    await tenantDb(tenantId).session.update({ where: { id: sessionId }, data: { revokedAt: null } });
  });

  test("ending a session actually writes, rather than matching nothing quietly", async () => {
    // updateMany on the raw client reports success having changed nothing,
    // which is the worst way for a revocation to fail.
    const unbound = await app.session.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    expect(unbound.count).toBe(0);

    const bound = await tenantDb(tenantId).session.updateMany({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    expect(bound.count).toBe(1);
  });
});
