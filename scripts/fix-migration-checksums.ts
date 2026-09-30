/**
 * Re-records the checksum of a migration whose file changed after it ran.
 *
 * Prisma stores a SHA-256 of each migration's SQL in `_prisma_migrations`. If
 * the file is edited afterwards — even a comment — the recorded hash no longer
 * matches, and `migrate dev` reports drift it cannot reconcile. Its only
 * offered remedy is `migrate reset`, which drops the database.
 *
 * That remedy is wrong here. The migration's *effects* are in the database and
 * have not changed; only a comment above them has. So this recomputes the hash
 * and updates the row, which is the narrowest correct fix.
 *
 * It refuses to touch anything else. A migration whose SQL genuinely changed
 * — different statements, not different comments — is a real problem that this
 * would paper over, so the script prints what it is about to do and only
 * proceeds when told to.
 *
 *   npx tsx scripts/fix-migration-checksums.ts          report
 *   npx tsx scripts/fix-migration-checksums.ts --apply  update the rows
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const DIR = join(process.cwd(), "prisma", "migrations");

function checksum(sql: string): string {
  // Prisma hashes the raw file bytes.
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const recorded = await db.$queryRaw<{ migration_name: string; checksum: string }[]>`
    SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at
  `;
  const byName = new Map(recorded.map((r) => [r.migration_name, r.checksum]));

  const folders = readdirSync(DIR).filter((entry) => statSync(join(DIR, entry)).isDirectory());

  const drifted: { name: string; from: string; to: string }[] = [];
  let matched = 0;

  for (const name of folders) {
    const stored = byName.get(name);
    if (!stored) {
      console.log(`  ${name}  not applied yet — nothing to fix`);
      continue;
    }

    const actual = checksum(readFileSync(join(DIR, name, "migration.sql"), "utf8"));
    if (actual === stored) {
      matched++;
      continue;
    }

    drifted.push({ name, from: stored, to: actual });
  }

  console.log(`\n  ${matched} migrations match their recorded checksum.`);

  if (drifted.length === 0) {
    console.log("  Nothing drifted.\n");
    return;
  }

  console.log(`  ${drifted.length} do not:\n`);
  for (const row of drifted) {
    console.log(`    ${row.name}`);
    console.log(`      recorded  ${row.from.slice(0, 16)}…`);
    console.log(`      on disk   ${row.to.slice(0, 16)}…`);
  }

  if (!apply) {
    console.log(`\n  Check each diff is a comment rather than a statement, then re-run with --apply.\n`);
    return;
  }

  for (const row of drifted) {
    await db.$executeRaw`
      UPDATE _prisma_migrations SET checksum = ${row.to} WHERE migration_name = ${row.name}
    `;
    console.log(`\n  re-recorded ${row.name}`);
  }

  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
