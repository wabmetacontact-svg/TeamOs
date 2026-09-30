/**
 * What is actually in the database right now.
 *
 * Connects with DIRECT_URL (the owner role) on purpose: it reports across the
 * whole database rather than one tenant, which is the point of a status check.
 * Nothing in the application ever connects this way.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

/** Slugs the test suites mint. They clean up after themselves; a crashed run
 *  leaves one behind. */
const TEST_TENANT = /^(test-[ab]|access|clients|brands|rel|merge|invites|ledger)-/;

async function main() {
  const tenants = await db.tenant.findMany({ orderBy: { createdAt: "asc" } });

  console.log(`\nTenants: ${tenants.length}`);

  for (const tenant of tenants) {
    // Test tenants pile up from the suite; they clean themselves up, but a
    // crashed run can leave one behind.
    const isTest = TEST_TENANT.test(tenant.slug);
    if (isTest) continue;

    console.log(`\n  ${tenant.name}  (${tenant.slug})  base ${tenant.baseCurrency}`);

    const [users, roles, brands, clients, contexts, people, relationships, transactions, categories, vendors] =
      await Promise.all([
        db.user.findMany({
          where: { tenantId: tenant.id },
          include: { role: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        db.role.count({ where: { tenantId: tenant.id } }),
        db.brand.count({ where: { tenantId: tenant.id } }),
        db.client.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        db.context.findMany({
          where: { tenantId: tenant.id },
          include: { _count: { select: { stages: true, relationships: true } } },
        }),
        db.person.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        db.relationship.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        db.transaction.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        db.category.count({ where: { tenantId: tenant.id } }),
        db.vendor.count({ where: { tenantId: tenant.id } }),
      ]);

    console.log(`    roles ${roles} · brands ${brands} · clients ${clients} · categories ${categories} · vendors ${vendors}`);
    console.log(`    pipelines ${contexts.length} (${contexts.map((c) => `${c.name}:${c._count.stages}`).join(", ") || "none"})`);
    console.log(`    people ${people} · relationships ${relationships} · ledger entries ${transactions}`);

    console.log(`    users:`);
    for (const user of users) {
      const twoFactor = user.twoFactorEnabled ? "2FA on" : "2FA off";
      const hash = user.passwordHash.startsWith("$2") ? "bcrypt" : "argon2";
      console.log(
        `      ${user.email.padEnd(32)} ${user.role.name.padEnd(8)} ${user.status.padEnd(12)} ${twoFactor.padEnd(8)} ${hash}`,
      );
    }
  }

  const stale = tenants.filter((t) => TEST_TENANT.test(t.slug));
  if (stale.length) {
    console.log(`\n  ${stale.length} leftover test tenants — harmless, but 'npm run db:clean-tests' removes them.`);
  }

  // The thing most likely to be wrong, and the most expensive to miss.
  const [{ rolname, rolbypassrls }] = await db.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
    SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  console.log(`\n  This script is connected as ${rolname} (BYPASSRLS ${rolbypassrls ? "YES" : "no"}) via DIRECT_URL.`);

  const appUrl = process.env.DATABASE_URL ?? "";
  const appRole = /postgresql:\/\/([^:]+):/.exec(appUrl)?.[1] ?? "unknown";
  console.log(`  The application connects as ${appRole} via DATABASE_URL.`);
  if (appRole === rolname) {
    console.log(`  ⚠  Those are the same role. Tenant isolation is OFF — run: npm run db:app-role`);
  } else {
    console.log(`  ✓  Different roles, which is what makes row-level security actually apply.\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
