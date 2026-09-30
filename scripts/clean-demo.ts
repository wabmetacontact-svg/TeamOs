/**
 * Removes everything `npm run db:demo` added, and nothing else.
 *
 * Every demo row carries a marker — clients a `demo` sub-tag, entries a `demo`
 * tag, people and vendors a note — and only rows carrying one are touched. A
 * real client you created while trying the application out stays.
 *
 * The closed book month and the audit entries both sit behind triggers that
 * refuse ordinary deletes, so this opens both escapes explicitly. That is what
 * they are for: a purge is possible, and has to be asked for in so many words.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const DEMO_TAG = "demo";

async function main() {
  const tenant = await db.tenant.findFirst({ where: { slug: "hephaestus" } });
  if (!tenant) throw new Error("No Hephaestus tenant.");
  const tenantId = tenant.id;

  const clients = await db.client.findMany({
    where: { tenantId, subTag: DEMO_TAG },
    select: { id: true, name: true },
  });

  if (clients.length === 0) {
    console.log("\n  No demo data found.\n");
    return;
  }

  const clientIds = clients.map((c) => c.id);
  console.log(`\n  Removing demo data from ${tenant.name}…`);

  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      // Both guards, because demo data deliberately includes a closed month
      // and every write left an audit entry behind it.
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;

      const people = await tx.person.findMany({
        where: { tenantId, notes: { contains: DEMO_TAG } },
        select: { id: true },
      });
      const personIds = people.map((p) => p.id);

      const counts = {
        transactions: (await tx.transaction.deleteMany({ where: { tenantId, clientId: { in: clientIds } } })).count,
        recurring: (await tx.recurringSpend.deleteMany({ where: { tenantId, clientId: { in: clientIds } } })).count,
        bookMonths: (await tx.bookMonth.deleteMany({ where: { tenantId, clientId: { in: clientIds } } })).count,
        activities: (await tx.activity.deleteMany({ where: { tenantId, personId: { in: personIds } } })).count,
        relationships: (await tx.relationship.deleteMany({ where: { tenantId, personId: { in: personIds } } })).count,
        contacts: (await tx.clientContact.deleteMany({ where: { tenantId, clientId: { in: clientIds } } })).count,
        people: (await tx.person.deleteMany({ where: { tenantId, id: { in: personIds } } })).count,
        clients: (await tx.client.deleteMany({ where: { tenantId, id: { in: clientIds } } })).count,
        vendors: (await tx.vendor.deleteMany({ where: { tenantId, notes: DEMO_TAG } })).count,
      };

      // The audit entries the demo writes left behind. Scoped to the rows that
      // just went, so nothing real is touched.
      const audit = await tx.auditEntry.deleteMany({
        where: {
          tenantId,
          OR: [
            { resourceType: "Client", resourceId: { in: clientIds } },
            { resourceType: "Person", resourceId: { in: personIds } },
          ],
        },
      });

      for (const [what, n] of Object.entries(counts)) {
        if (n > 0) console.log(`    ${n} ${what}`);
      }
      if (audit.count > 0) console.log(`    ${audit.count} audit entries`);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log(`\n  Gone. Your roles, brands, pipelines, categories and users are untouched.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
