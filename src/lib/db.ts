import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The raw client. Almost nothing should use this directly — it is not bound to
 * a tenant, so row-level security sees no `app.tenant_id` and returns nothing.
 * That is the safe failure, but it is still the wrong tool.
 *
 * Use `tenantDb(tenantId)` for anything tenant-owned, and keep the direct
 * client for the two tables that sit outside tenancy (tenants, permissions)
 * and for migrations and seeding.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * A client bound to one tenant.
 *
 * Every operation runs inside a transaction that first sets `app.tenant_id`,
 * which is what the row-level security policies read. The binding therefore
 * happens in the database, not in a `where` clause someone might forget: a
 * query with no tenant filter at all still cannot cross the boundary.
 */
export function tenantDb(tenantId: string) {
  if (!tenantId) throw new Error("tenantDb requires a tenant id");

  return db.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await db.$transaction([
          db.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
          query(args),
        ]);
        return result;
      },
    },
  });
}

export type TenantClient = ReturnType<typeof tenantDb>;

/**
 * Several writes that must succeed or fail together, inside one tenant.
 * The setting is applied once for the whole transaction.
 */
export async function tenantTransaction<T>(
  tenantId: string,
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return fn(tx);
  }, options);
}

/**
 * Runs with tenancy deliberately unset — for seeding, migrations and the
 * operational scripts the architecture keeps in a separate admin path.
 * Never reachable from a request.
 */
export async function asSystem<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return fn(tx as unknown as PrismaClient);
  }) as Promise<T>;
}
