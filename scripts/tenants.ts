/**
 * Prints the workspaces in this database, with their ids.
 *
 * `WABMETA_TENANT_ID` has to be an id rather than a slug, because the app role
 * cannot look a workspace up by slug: the `tenants` table's policy only shows
 * the row whose id is already in `app.tenant_id`, which is the whole point of
 * it. So the id is read here, as the owner, and pasted into the environment.
 *
 *   npx tsx scripts/tenants.ts
 */
import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";

async function main() {
  const direct = process.env.DIRECT_URL;
  if (!direct) throw new Error("DIRECT_URL must be set — this connects as the owner, which is what sees every row.");

  const db = new PrismaClient({ datasources: { db: { url: direct } } });
  const tenants = await db.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      _count: { select: { members: true, clients: true, ledger: true } },
    },
  });

  if (!tenants.length) {
    console.log("No workspaces yet. Sign up in the app first.");
  }

  for (const t of tenants) {
    console.log(`\n${t.name}  (${t.slug})`);
    console.log(`  id        ${t.id}`);
    console.log(`  status    ${t.status}`);
    console.log(`  created   ${t.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  contains  ${t._count.members} members, ${t._count.clients} clients, ${t._count.ledger} ledger entries`);
  }

  if (tenants.length) {
    console.log("\nSet WABMETA_TENANT_ID to the id of the workspace WabMeta should push into.");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
