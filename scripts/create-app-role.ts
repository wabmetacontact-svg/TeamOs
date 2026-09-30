/**
 * Creates the database role the application connects as.
 *
 * This exists because of a finding the Stage 0 gate caught: Neon's default role
 * (neondb_owner) carries BYPASSRLS, and BYPASSRLS beats even FORCE ROW LEVEL
 * SECURITY. Connecting as that role means every isolation policy is enabled,
 * forced, correct — and completely inert.
 *
 * So there are two roles, exactly as the architecture requires:
 *   owner (DIRECT_URL)    — runs migrations, owns the tables, bypasses RLS
 *   app   (DATABASE_URL)  — what every request uses; no BYPASSRLS, no ownership
 *
 * Run it once per database (local, staging, production):
 *   npx tsx scripts/create-app-role.ts
 *
 * It is safe to re-run: the role is reused and its grants are refreshed, which
 * is also how you pick up tables added by a later migration.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ROLE = "teamos_app";

async function main() {
  const direct = process.env.DIRECT_URL;
  if (!direct) throw new Error("DIRECT_URL must be set — this connects as the owner.");

  // Always run against the direct (owner) connection.
  const db = new PrismaClient({ datasources: { db: { url: direct } } });

  const [{ current_database: database }] = await db.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const existing = await db.$queryRaw<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname = ${ROLE}`;

  const password = randomBytes(24).toString("base64url");
  if (existing.length) {
    console.log(`role ${ROLE} exists — rotating its password and refreshing grants`);
    await db.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOBYPASSRLS`);
  } else {
    console.log(`creating role ${ROLE}`);
    await db.$executeRawUnsafe(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOBYPASSRLS`);
  }

  // Exactly what an application needs, and nothing more: no DDL, no ownership,
  // no ability to disable a policy.
  const grants = [
    `GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
    // Tables created by future migrations are granted automatically.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
  ];
  for (const sql of grants) await db.$executeRawUnsafe(sql);

  // The audit log stays append-only for this role too: the trigger enforces it,
  // but removing the grants means it cannot even be attempted.
  await db.$executeRawUnsafe(`REVOKE UPDATE, DELETE ON "audit_log" FROM ${ROLE}`);

  const verify = await db.$queryRaw<{ rolbypassrls: boolean }[]>`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = ${ROLE}
  `;
  if (verify[0]?.rolbypassrls) throw new Error(`${ROLE} still has BYPASSRLS — isolation would be inert`);
  console.log(`${ROLE}: NOBYPASSRLS confirmed, grants applied`);

  // Rewrite DATABASE_URL to connect as the app role, keeping DIRECT_URL as the
  // owner so migrations still work.
  const url = new URL(direct.replace(/^postgres(ql)?:\/\//, "https://"));
  const appUrl = direct
    .replace(`${url.username}:${url.password}@`, `${ROLE}:${password}@`)
    // The app runs through the pooled endpoint; migrations do not.
    .replace(url.hostname, url.hostname.replace(/^([^.]+)\./, "$1-pooler."));

  const envPath = ".env";
  const env = readFileSync(envPath, "utf8");
  const updated = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${appUrl}"`);
  if (updated === env) throw new Error("Could not find DATABASE_URL in .env to update");
  writeFileSync(envPath, updated);

  console.log("\n.env updated: DATABASE_URL now connects as the app role.");
  console.log("Copy that same value into your hosting provider's DATABASE_URL.");
  console.log(`(masked: postgresql://${ROLE}:****@${url.hostname.replace(/^([^.]+)\./, "$1-pooler.")}…)`);

  await db.$disconnect();
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
