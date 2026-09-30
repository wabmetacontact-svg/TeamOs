/**
 * Removes tenants left behind by a crashed test run.
 *
 * Deleting a tenant cascades into the audit log, which is append-only by
 * trigger, and into closed book months, which are guarded by another — so both
 * escape hatches have to be opened explicitly. That is the point of them: a
 * purge is possible and has to be asked for in so many words.
 *
 * It will not touch a tenant whose slug does not match a test pattern, and it
 * says what it is about to do before doing it.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const TEST_TENANT = /^(test-[ab]|access|clients|brands|rel|merge|invites|ledger)-/;

async function main() {
  const tenants = await db.tenant.findMany({ orderBy: { createdAt: "asc" } });
  const doomed = tenants.filter((t) => TEST_TENANT.test(t.slug));
  const kept = tenants.filter((t) => !TEST_TENANT.test(t.slug));

  console.log(`\nKeeping ${kept.length}: ${kept.map((t) => t.name).join(", ") || "none"}`);

  if (doomed.length === 0) {
    console.log("Nothing to clean.\n");
    return;
  }

  console.log(`Removing ${doomed.length} test ${doomed.length === 1 ? "tenant" : "tenants"}…`);

  for (const tenant of doomed) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
      await tx.tenant.delete({ where: { id: tenant.id } });
    });
    console.log(`  removed ${tenant.slug}`);
  }

  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
