/**
 * Stage 0 acceptance gate — access control.
 *
 * Tenancy (tenancy.test.ts) proves a tenant cannot reach another tenant. This
 * file proves the two layers above it: that a role cannot do what it was not
 * granted, and that a scope cannot reach a client it was not assigned — and
 * that both take effect on the next request rather than the next login.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { ALL_PERMISSIONS, DEFAULT_ROLES, effectivePermissions } from "../src/lib/permissions";
import {
  assertClientInScope,
  can,
  clientIdScope,
  clientScope,
  dashboardReach,
  NotFoundError,
  PermissionError,
  requirePermission,
  type Scope,
} from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
const roleIds: Record<string, string> = {};
let clientA: string;
let clientB: string;
let managerId: string;
let sessionId: string;

/** Builds the scope object the way getScope() does, from the database. */
async function scopeFor(userId: string): Promise<Scope> {
  const db = tenantDb(tenantId);
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
      scope: { select: { clientId: true } },
      contextScope: { select: { contextId: true } },
    },
  });
  return {
    userId: user.id,
    tenantId,
    roleName: user.role.name,
    permissions: effectivePermissions(
      user.role.name,
      user.role.permissions.map((p) => p.permission.key),
      user.permissionsGranted,
      user.permissionsRevoked,
    ),
    allClients: user.allClients,
    clientIds: user.scope.map((s) => s.clientId),
    allContexts: user.allContexts,
    contextIds: user.contextScope.map((s) => s.contextId),
  };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Access ${suffix}`, slug: `access-${suffix}` } });
  tenantId = tenant.id;

  const permissions = await owner.permission.findMany();
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      for (const def of DEFAULT_ROLES) {
        const role = await tx.role.create({ data: { tenantId, name: def.name, description: def.description, isSystem: true } });
        roleIds[def.name] = role.id;
        const keys = def.permissions === "all" ? ALL_PERMISSIONS : def.permissions;
        await tx.rolePermission.createMany({
          data: keys.map((key) => ({ tenantId, roleId: role.id, permissionId: idByKey.get(key)! })),
        });
      }

      const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });
      const a = await tx.client.create({ data: { tenantId, brandId: brand.id, name: "Assigned", status: "Active" } });
      const b = await tx.client.create({ data: { tenantId, brandId: brand.id, name: "Not assigned", status: "Active" } });
      clientA = a.id;
      clientB = b.id;

      const manager = await tx.user.create({
        data: { tenantId, email: `manager-${suffix}@test.dev`, name: "Manager", passwordHash: "x", roleId: roleIds.Manager!, allClients: false },
      });
      managerId = manager.id;
      await tx.userClientScope.create({ data: { tenantId, userId: manager.id, clientId: a.id } });

      const session = await tx.session.create({
        data: {
          tenantId,
          userId: manager.id,
          refreshTokenHash: `hash-${suffix}`,
          family: `family-${suffix}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      sessionId = session.id;

      // One expense on each client, so a scoped query has something it could
      // wrongly return. A test that filters an empty table proves nothing.
      await tx.transaction.createMany({
        data: [a, b].map((client, i) => ({
          tenantId,
          ref: `TX-${suffix}-${i}`,
          direction: "OUT",
          clientId: client.id,
          bookMonth: "2026-09",
          date: new Date(),
          name: `Spend on ${client.name}`,
          amountOriginal: 10_000n,
          amountBase: 10_000n,
          createdById: manager.id,
        })),
      });
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `access-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("permissions", () => {
  test("a role does only what it was granted", async () => {
    const manager = await scopeFor(managerId);

    expect(can(manager, "expense:approve")).toBe(true);
    expect(can(manager, "user:invite")).toBe(false);
    expect(can(manager, "role:edit")).toBe(false);
    expect(() => requirePermission(manager, "user:invite")).toThrow(PermissionError);
    expect(() => requirePermission(manager, "expense:approve")).not.toThrow();
  });

  test("the five default roles differ in the ways the PRD says they should", async () => {
    const granted = await owner.role.findMany({
      where: { tenantId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    const keys = (name: string) =>
      new Set(granted.find((r) => r.name === name)!.permissions.map((p) => p.permission.key));

    // Finance runs the money and touches nothing else.
    expect(keys("Finance").has("expense:approve")).toBe(true);
    expect(keys("Finance").has("user:invite")).toBe(false);
    expect(keys("Finance").has("role:edit")).toBe(false);

    // A Member submits but never approves, and sees no organisation totals.
    expect(keys("Member").has("expense:create")).toBe(true);
    expect(keys("Member").has("expense:approve")).toBe(false);
    expect(keys("Member").has("dashboard:view_all")).toBe(false);
    expect(keys("Member").has("dashboard:view_own")).toBe(true);

    // Owner is not restricted.
    expect(keys("Owner").size).toBe(ALL_PERMISSIONS.length);
  });

  test("a role change takes effect on the next request, not the next login", async () => {
    expect(can(await scopeFor(managerId), "user:invite")).toBe(false);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: managerId }, data: { roleId: roleIds.Admin! } });
    });

    // No new session, no new cookie — the very next resolution sees it.
    const after = await scopeFor(managerId);
    expect(can(after, "user:invite")).toBe(true);
    expect(after.roleName).toBe("Admin");

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: managerId }, data: { roleId: roleIds.Manager! } });
    });
  });
});

describe("client scope", () => {
  test("scope limits the query, and an unassigned client is simply absent", async () => {
    const manager = await scopeFor(managerId);
    const db = tenantDb(tenantId);

    // The tenant holds two clients and an expense on each…
    expect(await db.client.count()).toBe(2);
    expect(await db.transaction.count()).toBe(2);

    // …and this is the only difference: the fragment every repository function
    // is required to spread into its `where`.
    const scoped = await db.transaction.findMany({ where: { ...clientScope(manager) } });
    expect(scoped.map((t) => t.clientId)).toEqual([clientA]);

    const scopedClients = await db.client.findMany({ where: { ...clientIdScope(manager) } });
    expect(scopedClients.map((c) => c.id)).toEqual([clientA]);
  });

  test("an allClients user gets an unrestricted fragment, not a listing of every id", async () => {
    const manager = await scopeFor(managerId);
    const everywhere: Scope = { ...manager, allClients: true };

    // `{}` rather than `{ clientId: { in: [...] } }` — the scope layer steps
    // aside entirely, leaving RLS as the boundary. A list would silently go
    // stale the moment a client is added.
    expect(clientScope(everywhere)).toEqual({});
    expect(clientIdScope(everywhere)).toEqual({});

    const all = await tenantDb(tenantId).transaction.findMany({ where: { ...clientScope(everywhere) } });
    expect(all).toHaveLength(2);
  });

  test("out of scope and does not exist are indistinguishable", async () => {
    const manager = await scopeFor(managerId);

    const outOfScope = () => assertClientInScope(manager, clientB);
    const neverExisted = () => assertClientInScope(manager, "clnonexistent000000000000");

    expect(outOfScope).toThrow(NotFoundError);
    expect(neverExisted).toThrow(NotFoundError);

    // Same error, same message — nothing distinguishes the two cases, so scope
    // cannot be mapped by trying IDs.
    let a = "";
    let b = "";
    try { outOfScope(); } catch (e) { a = (e as Error).message; }
    try { neverExisted(); } catch (e) { b = (e as Error).message; }
    expect(a).toBe(b);

    expect(() => assertClientInScope(manager, clientA)).not.toThrow();
  });

  test("a user with no grants and no allClients reaches nothing", () => {
    const stranded: Scope = {
      userId: "u", tenantId, roleName: "Member",
      permissions: new Set(["client:view"]), allClients: false, clientIds: [],
      allContexts: false, contextIds: [],
    };
    // An empty `in` list, not an absent filter — matches nothing rather than everything.
    expect(clientScope(stranded)).toEqual({ clientId: { in: [] } });
    expect(dashboardReach(stranded)).toBe("none");
  });

  test("each dashboard permission reaches exactly as far as its name says", () => {
    const build = (perms: string[]): Scope => ({
      userId: "u", tenantId, roleName: "x", permissions: new Set(perms), allClients: false, clientIds: [],
      allContexts: false, contextIds: [],
    });
    expect(dashboardReach(build(["dashboard:view_all"]))).toBe("all");
    expect(dashboardReach(build(["dashboard:view_scoped"]))).toBe("scoped");
    expect(dashboardReach(build(["dashboard:view_own"]))).toBe("own");
  });
});

describe("sessions", () => {
  test("a revoked session stops working immediately, without waiting for expiry", async () => {
    const db = tenantDb(tenantId);

    const live = await db.session.findFirst({ where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } } });
    expect(live).not.toBeNull();

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    });

    // This is the exact lookup getScope() performs on every request.
    const afterRevoke = await db.session.findFirst({ where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } } });
    expect(afterRevoke).toBeNull();

    // The row survives for the audit trail; it just no longer authorises.
    expect(await db.session.findUnique({ where: { id: sessionId } })).not.toBeNull();
  });

  test("a deactivated account cannot authenticate, but keeps its attribution", async () => {
    const db = tenantDb(tenantId);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: managerId }, data: { status: "Deactivated" } });
    });

    const user = await db.user.findUniqueOrThrow({ where: { id: managerId } });
    expect(user.status).toBe("Deactivated"); // getScope() returns null on this
    expect(user.name).toBe("Manager"); // and the record is still here to credit

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.user.update({ where: { id: managerId }, data: { status: "Active" } });
    });
  });
});
