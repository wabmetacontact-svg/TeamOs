/**
 * Structure that has to hold for tenant isolation to mean anything, checked
 * from the schema and migration files themselves.
 *
 * A new table that forgets its tenantId, its foreign key or its row-level
 * security policy fails here, before it can ever reach a database.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
const migrationsDir = join(__dirname, "../prisma/migrations");
const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => readFileSync(join(migrationsDir, d.name, "migration.sql"), "utf8"))
  .join("\n");

const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
  name: name!,
  body: body!,
  table: body!.match(/@@map\("([^"]+)"\)/)?.[1] ?? name!,
}));

describe("every table belongs to a tenant", () => {
  const owned = models.filter((m) => m.name !== "Tenant");

  test("there are tables to check", () => {
    expect(owned.length).toBeGreaterThan(10);
  });

  test.each(owned.map((m) => [m.name, m] as const))("%s has tenantId with a foreign key to tenants", (_, m) => {
    expect(m.body).toMatch(/^\s+tenantId\s+String\b/m);
    expect(m.body).toMatch(/tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\]/);
  });

  test.each(owned.map((m) => [m.table] as const))("%s has row-level security, forced, with a tenant policy", (table) => {
    expect(migrations).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    expect(migrations).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    expect(migrations).toMatch(new RegExp(`CREATE POLICY tenant_isolation ON "${table}"\\s+USING \\("tenantId" = current_setting\\('app\\.tenant_id', true\\)\\)`));
  });

  test("the tenants table itself is limited to the current tenant", () => {
    expect(migrations).toContain('ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;');
    expect(migrations).toMatch(/CREATE POLICY tenant_self ON "tenants"/);
  });
});

describe("money is never a float", () => {
  test("no Float column anywhere", () => {
    expect(schema).not.toMatch(/\bFloat\b/);
  });
});
