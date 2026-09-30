/**
 * Stage 0 acceptance gate — tenant isolation.
 *
 * These run against the real database, because the claim being tested is about
 * Postgres, not about TypeScript. The headline test deliberately writes a query
 * with NO tenant filter at all: if isolation depended on application code
 * remembering a `where` clause, that query would return another tenant's rows.
 *
 * Two throwaway tenants are created and removed; nothing else is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { db, tenantDb } from "../src/lib/db";

// Two clients, because the difference between them is the whole point:
//   owner — runs setup and teardown; bypasses RLS by design
//   app   — how a request connects; subject to every policy
const raw = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const appRole = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = Date.now().toString(36);

let tenantA: string;
let tenantB: string;
let brandB: string;

/** Creates a tenant with one brand and one client, as the system would. */
async function makeTenant(label: string) {
  const tenant = await raw.tenant.create({ data: { name: `Test ${label} ${suffix}`, slug: `test-${label}-${suffix}` } });
  const { brandId } = await raw.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, TRUE)`;
    const brand = await tx.brand.create({ data: { tenantId: tenant.id, name: `Brand ${label}` } });
    await tx.client.create({ data: { tenantId: tenant.id, brandId: brand.id, name: `Client ${label}`, status: "Active" } });
    return { brandId: brand.id };
  });
  return { id: tenant.id, brandId };
}

beforeAll(async () => {
  const a = await makeTenant("a");
  const b = await makeTenant("b");
  tenantA = a.id;
  tenantB = b.id;
  brandB = b.brandId;
}, 60_000);

afterAll(async () => {
  // Deleting a tenant cascades into audit_log, which is append-only — so the
  // purge declares itself, the same way tenant offboarding has to.
  await raw.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: { in: [`test-a-${suffix}`, `test-b-${suffix}`] } } });
  });
  await raw.$disconnect();
  await appRole.$disconnect();
  await db.$disconnect();
});

describe("row-level security", () => {
  test("a query with no tenant filter still cannot cross the boundary", async () => {
    // findMany() with no `where` whatsoever — the exact mistake RLS exists to catch.
    const fromA = await tenantDb(tenantA).client.findMany();
    const fromB = await tenantDb(tenantB).client.findMany();

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0]!.name).toBe("Client a");
    expect(fromB[0]!.name).toBe("Client b");
    expect(fromA[0]!.id).not.toBe(fromB[0]!.id);
  });

  test("another tenant's record cannot be fetched by its id", async () => {
    const [clientB] = await tenantDb(tenantB).client.findMany();
    const probe = await tenantDb(tenantA).client.findUnique({ where: { id: clientB!.id } });

    // Not "forbidden" — simply not there, which is what makes IDs unprobeable.
    expect(probe).toBeNull();
  });

  test("a write that claims another tenant is rejected", async () => {
    await expect(
      tenantDb(tenantA).client.create({
        data: { tenantId: tenantB, brandId: brandB, name: "Smuggled", status: "Active" },
      }),
    ).rejects.toThrow();
  });

  test("another tenant's record cannot be updated or deleted", async () => {
    const [clientB] = await tenantDb(tenantB).client.findMany();

    const updated = await tenantDb(tenantA).client.updateMany({ where: { id: clientB!.id }, data: { name: "Hijacked" } });
    const deleted = await tenantDb(tenantA).client.deleteMany({ where: { id: clientB!.id } });

    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const [stillThere] = await tenantDb(tenantB).client.findMany();
    expect(stillThere!.name).toBe("Client b");
  });

  test("with no tenant set, nothing is visible at all — it fails closed", async () => {
    // The app role, with app.tenant_id never set, so the policy matches nothing.
    const rows = await appRole.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM "clients"
    `;
    expect(Number(rows[0]!.count)).toBe(0);
  });

  test("every tenant-owned table carries the boundary, not just clients", async () => {
    const aDb = tenantDb(tenantA);
    const bDb = tenantDb(tenantB);

    await aDb.person.create({ data: { tenantId: tenantA, name: "Person A" } });
    await bDb.person.create({ data: { tenantId: tenantB, name: "Person B" } });
    await aDb.brand.findMany();

    expect((await aDb.person.findMany()).map((p) => p.name)).toEqual(["Person A"]);
    expect((await bDb.person.findMany()).map((p) => p.name)).toEqual(["Person B"]);
    expect((await aDb.brand.findMany()).map((b) => b.name)).toEqual(["Brand a"]);
  });
});

describe("audit log", () => {
  test("entries can be written but never changed or removed", async () => {
    const aDb = tenantDb(tenantA);
    const entry = await aDb.auditEntry.create({
      data: { tenantId: tenantA, action: "created", resourceType: "Client", resourceId: "x", after: { name: "x" } },
    });

    // Two things stand in the way and either is enough: the app role holds no
    // UPDATE or DELETE grant, and a trigger raises if one is ever restored.
    const refused = /append-only|permission denied/i;
    await expect(aDb.auditEntry.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow(refused);
    await expect(aDb.auditEntry.delete({ where: { id: entry.id } })).rejects.toThrow(refused);

    const still = await aDb.auditEntry.findUnique({ where: { id: entry.id } });
    expect(still?.action).toBe("created");
  });

  test("a purge has to declare itself, and only then succeeds", async () => {
    const entry = await tenantDb(tenantA).auditEntry.create({
      data: { tenantId: tenantA, action: "created", resourceType: "Client", resourceId: "y" },
    });

    // Owner credentials alone are not enough.
    await expect(raw.auditEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/i);

    await raw.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      await tx.auditEntry.delete({ where: { id: entry.id } });
    });
    expect(await raw.auditEntry.findUnique({ where: { id: entry.id } })).toBeNull();
  });
});
