/**
 * Creating a workspace from the outside.
 *
 * Two things here are worth proving rather than trusting.
 *
 * A new workspace has to be *usable*. A tenant row on its own is a working
 * application that refuses to do anything: no roles, so nobody can be granted
 * anything; no categories, so every ledger entry is uncategorised. The first
 * person through the door would leave.
 *
 * And a new workspace has to be *isolated from the first minute*. The whole
 * point of building multi-tenancy from line one is that the second tenant is
 * not a special case — so the same no-filter query that proves it for two
 * seeded tenants is run here against one that was provisioned through the
 * signup path.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { hashPassword, resolveLoginTenants } from "../src/lib/auth";
import { ensurePermissions, provisionTenant, uniqueSlug } from "../src/lib/provisioning";
import { ALL_PERMISSIONS } from "../src/lib/permissions";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const suffix = Date.now().toString(36);
const created: string[] = [];

async function provision(name: string, email: string) {
  const result = await provisionTenant({
    workspaceName: name,
    ownerEmail: email,
    ownerName: "First Owner",
    passwordHash: await hashPassword("a-password-long-enough"),
  });
  created.push(result.tenantId);
  return result;
}

beforeAll(async () => {
  await ensurePermissions();
}, 90_000);

afterAll(async () => {
  for (const tenantId of created) {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
  }
  await owner.$disconnect();
  await app.$disconnect();
});

describe("a new workspace is usable on its first day", () => {
  test("it arrives with roles and a chart of accounts, and no pipelines", async () => {
    const { tenantId, userId } = await provision(`Acme ${suffix}`, `owner-acme-${suffix}@test.dev`);
    const db = tenantDb(tenantId);

    const [roles, contexts, stages, categories, users] = await Promise.all([
      db.role.findMany({ include: { _count: { select: { permissions: true } } } }),
      db.context.count(),
      db.pipelineStage.count(),
      db.category.count(),
      db.user.findMany({ include: { role: { select: { name: true } } } }),
    ]);

    expect(roles.map((r) => r.name).sort()).toEqual(["Admin", "Finance", "Manager", "Member", "Owner"]);
    // Pipelines were removed from the product; a pipeline nobody can see or
    // edit is clutter in the database, not a starting point.
    expect(contexts).toBe(0);
    expect(stages).toBe(0);
    expect(categories).toBeGreaterThan(0);

    // The first user owns the place and can reach everything in it.
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(userId);
    expect(users[0]!.role.name).toBe("Owner");
    expect(users[0]!.allClients).toBe(true);
    expect(users[0]!.allContexts).toBe(true);
    // They arrived by clicking a link sent to the address, which is the proof.
    expect(users[0]!.emailVerifiedAt).not.toBeNull();
  });

  test("the Owner role really holds every permission, not a subset", async () => {
    const tenantId = created[0]!;
    const owner_ = await tenantDb(tenantId).role.findFirstOrThrow({
      where: { name: "Owner" },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });

    // A role that is missing a key nobody noticed is a permission check that
    // silently denies forever.
    expect(owner_.permissions.map((p) => p.permission.key).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  test("a Member cannot approve its own spend, in a workspace nobody configured", async () => {
    const tenantId = created[0]!;
    const member = await tenantDb(tenantId).role.findFirstOrThrow({
      where: { name: "Member" },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });

    const keys = new Set(member.permissions.map((p) => p.permission.key));
    expect(keys.has("expense:create")).toBe(true);
    expect(keys.has("expense:approve")).toBe(false);
    expect(keys.has("dashboard:view_all")).toBe(false);
  });

  test("no brands or clients are invented", async () => {
    const tenantId = created[0]!;
    const db = tenantDb(tenantId);

    // Guessing at these produces four rows called "Brand 1" that everybody
    // deletes before they can start.
    expect(await db.brand.count()).toBe(0);
    expect(await db.client.count()).toBe(0);
  });
});

describe("the second workspace is isolated from the first", () => {
  test("neither can see the other, with no filter in the query at all", async () => {
    const a = await provision(`Alpha ${suffix}`, `owner-alpha-${suffix}@test.dev`);
    const b = await provision(`Beta ${suffix}`, `owner-beta-${suffix}@test.dev`);

    const dbA = tenantDb(a.tenantId);
    const dbB = tenantDb(b.tenantId);

    // No where clause. Whatever the policy permits is what comes back.
    const usersA = await dbA.user.findMany();
    const usersB = await dbB.user.findMany();

    expect(usersA.every((u) => u.tenantId === a.tenantId)).toBe(true);
    expect(usersB.every((u) => u.tenantId === b.tenantId)).toBe(true);
    expect(usersA.some((u) => u.id === b.userId)).toBe(false);
    expect(usersB.some((u) => u.id === a.userId)).toBe(false);

    // The same for the roles each of them just had created.
    const rolesA = await dbA.role.findMany();
    expect(rolesA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  test("one cannot reach the other's row even by naming its id", async () => {
    const [a, b] = created.slice(-2);

    // The shape that broke clients and contexts twice: a caller-supplied id
    // must narrow what scope permits, never replace it.
    expect(await tenantDb(a!).user.findFirst({ where: { tenantId: b! } })).toBeNull();
    expect(await tenantDb(a!).role.findMany({ where: { tenantId: b! } })).toHaveLength(0);
  });

  test("the application role sees nothing at all without a tenant", async () => {
    // Every query in the application binds to a tenant. This is what is left
    // if one ever forgets to.
    expect(await app.user.findMany()).toHaveLength(0);
    expect(await app.role.findMany()).toHaveLength(0);
    expect(await app.context.findMany()).toHaveLength(0);
  });
});

describe("signing in to more than one workspace", () => {
  test("the same address in two workspaces resolves to both", async () => {
    const shared = `shared-${suffix}@test.dev`;
    const first = await provision(`Shared One ${suffix}`, shared);

    // The unique index on users is (tenantId, email), not email alone — which
    // is what lets a person work for two agencies at once.
    const second = await provision(`Shared Two ${suffix}`, shared);

    const workspaces = await resolveLoginTenants(shared);
    expect(workspaces.map((w) => w.tenantId).sort()).toEqual([first.tenantId, second.tenantId].sort());
    // The picker needs names, and gets them.
    expect(workspaces.every((w) => w.name.length > 0)).toBe(true);
  });

  test("a suspended workspace drops out of the list, leaving the other", async () => {
    const shared = `shared-${suffix}@test.dev`;
    const [, second] = await resolveLoginTenants(shared);

    await owner.tenant.update({ where: { id: second!.tenantId }, data: { status: "Suspended" } });
    const after = await resolveLoginTenants(shared);

    expect(after.map((w) => w.tenantId)).not.toContain(second!.tenantId);
    expect(after).toHaveLength(1);

    await owner.tenant.update({ where: { id: second!.tenantId }, data: { status: "Active" } });
  });
});

describe("slugs", () => {
  test("a name becomes something readable and url-safe", async () => {
    expect(await uniqueSlug("Hephaestus Studios")).toMatch(/^hephaestus-studios/);
    expect(await uniqueSlug("  ACME & Co!  ")).toMatch(/^acme-co/);
    // Nothing usable left is still a slug rather than an empty string.
    expect(await uniqueSlug("!!!")).toMatch(/^workspace/);
  });

  test("a collision is resolved by counting, not by random characters", async () => {
    const name = `Collide ${suffix}`;
    const first = await provision(name, `c1-${suffix}@test.dev`);

    const next = await uniqueSlug(name);
    // The slug is something people read and say out loud, so -2 beats -x7f9q.
    expect(next).toMatch(/-2$/);

    const stored = await owner.tenant.findUniqueOrThrow({ where: { id: first.tenantId } });
    expect(next).not.toBe(stored.slug);
  });
});

describe("the permission catalogue stays in step with the code", () => {
  test("every key in the catalogue exists as a row", async () => {
    await ensurePermissions();
    const rows = await owner.permission.findMany({ select: { key: true } });
    const have = new Set(rows.map((r) => r.key));

    // A workspace provisioned before a permission was added would otherwise
    // silently lack it, and every check against it would deny forever.
    const missing = ALL_PERMISSIONS.filter((key) => !have.has(key));
    expect(missing).toEqual([]);
  });

  test("running it again adds nothing", async () => {
    expect(await ensurePermissions()).toBe(0);
  });
});
