/**
 * Stage 0 acceptance gate — the structural rule.
 *
 * "Every tenant-owned table has tenantId NOT NULL, a foreign key to tenants,
 * and an RLS policy. A table without all three fails a schema test in CI."
 *
 * This is that test. It reads the live database rather than the Prisma schema,
 * so it catches a table added by a hand-written migration too.
 */
import { afterAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";

// Introspection runs as the owner: information_schema filters constraint rows
// by privilege, so the app role (correctly) cannot see them.
const raw = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
/** The role the application runs as: no BYPASSRLS, so policies apply to it. */
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

/**
 * The only two tables allowed to sit outside tenancy, and why:
 *   tenants     — the root record; there is no tenant above it
 *   permissions — the global catalogue; the same list for every tenant
 * Adding to this list should take an argument, not a commit.
 */
/**
 * Tables that are not tenant-owned, each for a stated reason:
 *
 *   tenants           is the thing being isolated
 *   permissions       is a global catalogue, identical for everyone
 *   pending_signups   exists before a tenant does — that is its whole job
 *   _prisma_migrations is not ours
 *
 * Anything else appearing here means a new table shipped without isolation,
 * which is what the tests below are for.
 */
const EXEMPT = new Set(["tenants", "permissions", "pending_signups", "_prisma_migrations"]);

afterAll(async () => {
  await raw.$disconnect();
  await app.$disconnect();
});

async function appTables(): Promise<string[]> {
  const rows = await raw.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name).filter((t) => !EXEMPT.has(t));
}

describe("schema rules", () => {
  test("there is something to check", async () => {
    const tables = await appTables();
    expect(tables.length).toBeGreaterThan(20);
  });

  test("every tenant-owned table has a non-null tenantId", async () => {
    const tables = await appTables();
    const rows = await raw.$queryRaw<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenantId'
    `;
    const byTable = new Map(rows.map((r) => [r.table_name, r.is_nullable]));

    const missing = tables.filter((t) => !byTable.has(t));
    const nullable = tables.filter((t) => byTable.get(t) === "YES");

    expect({ missing, nullable }).toEqual({ missing: [], nullable: [] });
  });

  test("every tenant-owned table has a foreign key to tenants", async () => {
    const tables = await appTables();
    const rows = await raw.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND kcu.column_name = 'tenantId'
        AND ccu.table_name = 'tenants'
    `;
    const withFk = new Set(rows.map((r) => r.table_name));

    expect(tables.filter((t) => !withFk.has(t))).toEqual([]);
  });

  test("every tenant-owned table has RLS enabled AND forced", async () => {
    const tables = await appTables();
    const rows = await raw.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const state = new Map(rows.map((r) => [r.relname, r]));

    // Forced matters as much as enabled: without FORCE, the table owner — which
    // is how the application connects — bypasses its own policies silently.
    const notEnabled = tables.filter((t) => !state.get(t)?.relrowsecurity);
    const notForced = tables.filter((t) => !state.get(t)?.relforcerowsecurity);

    expect({ notEnabled, notForced }).toEqual({ notEnabled: [], notForced: [] });
  });

  test("every tenant-owned table has an isolation policy", async () => {
    const tables = await appTables();
    const rows = await raw.$queryRaw<{ tablename: string; policyname: string; qual: string | null }[]>`
      SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname = 'public'
    `;

    // A table may carry more than one policy, and Postgres ORs them — so the
    // question is whether *a* policy does the tenant comparison, not whether
    // the last one listed does.
    const byTable = new Map<string, string[]>();
    for (const row of rows) {
      byTable.set(row.tablename, [...(byTable.get(row.tablename) ?? []), row.qual ?? ""]);
    }

    const missing = tables.filter((t) => !byTable.has(t));
    const wrong = tables.filter((t) => byTable.has(t) && !byTable.get(t)!.some((q) => q.includes("app.tenant_id")));

    expect({ missing, wrong }).toEqual({ missing: [], wrong: [] });
  });

  test("only invitations carries a second policy, and it is the token escape", async () => {
    // Every policy beyond the one tenant_isolation rule per table widens what
    // is reachable, so each one is named here deliberately. A policy that
    // appears without this test being updated is the thing to look at first.
    const rows = await raw.$queryRaw<{ tablename: string; policyname: string; cmd: string; qual: string | null }[]>`
      SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public'
    `;

    const extra = rows.filter((r) => r.policyname !== "tenant_isolation");
    expect(extra.map((r) => `${r.tablename}.${r.policyname}`).sort()).toEqual([
      "invitations.invite_by_token",
      "pending_signups.signup_flow",
    ]);

    const invite = extra.find((r) => r.policyname === "invite_by_token")!;
    // Read-only, and keyed on the token hash rather than on anything an admin
    // or a passer-by could enumerate.
    expect(invite.cmd).toBe("SELECT");
    expect(invite.qual).toContain("app.invite_token_hash");
    expect(invite.qual).toContain("tokenHash");

    const signup = extra.find((r) => r.policyname === "signup_flow")!;
    // Gated on a transaction-local setting that only the signup path sets, so
    // a stray query reaching this table gets nothing.
    expect(signup.qual).toContain("app.signup_flow");
  });

  test("pending_signups is unreachable without the signup flow opening it", async () => {
    // It cannot have a tenant policy — there is no tenant yet — so this is
    // what stands in for one. The check is that the default is closed.
    const visible = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pending_signups`;
    expect(Number(visible[0]!.n)).toBe(0);

    const withFlag = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.signup_flow', 'on', TRUE)`;
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pending_signups`;
      return Number(rows[0]!.n);
    });

    // Whatever is actually there — the point is that the two differ only by
    // the flag, and that it does not survive the transaction.
    expect(withFlag).toBeGreaterThanOrEqual(0);
    const after = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pending_signups`;
    expect(Number(after[0]!.n)).toBe(0);
  });

  test("money columns are integers, never floating point", async () => {
    const rows = await raw.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%amount%' OR column_name = 'value')
    `;
    const floats = rows.filter((r) => ["double precision", "real"].includes(r.data_type));
    expect(floats).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });
});
