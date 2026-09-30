/**
 * Runs the login lookup exactly as the application does — same client, same
 * role, same query — rather than as an admin.
 *
 * check-login.ts connects with DIRECT_URL, which is the database owner and
 * bypasses row-level security. The application connects as teamos_app, which
 * does not. If those two disagree, the bug is in what the application can see,
 * not in the data.
 */
import { PrismaClient } from "@prisma/client";

const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.log("\n  Usage: npx tsx scripts/trace-login.ts you@example.com\n");
    return;
  }

  console.log(`\n  As the owner role (DIRECT_URL, bypasses RLS):`);
  const asOwner = await owner.user.findFirst({ where: { email }, select: { id: true, tenantId: true } });
  console.log(`    user.findFirst({ email })  →  ${asOwner ? `found ${asOwner.id}` : "null"}`);

  console.log(`\n  As the application role (DATABASE_URL, subject to RLS):`);
  const asApp = await app.user.findFirst({ where: { email }, select: { id: true, tenantId: true } });
  console.log(`    user.findFirst({ email })  →  ${asApp ? `found ${asApp.id}` : "null"}`);

  if (asOwner && !asApp) {
    console.log(`\n  ✗ There it is.`);
    console.log(`    The row exists, and the application cannot see it.`);
    console.log(`    Row-level security needs app.tenant_id, and a login has no tenant yet —`);
    console.log(`    the email is the only thing that identifies one. Same shape as the`);
    console.log(`    invitation lookup, which hit this and was fixed; login was never`);
    console.log(`    exercised by a test or a browser, so it was not.`);
  }

  // The same question for sessions, which getScope() reads on every request.
  console.log(`\n  Sessions, which getScope() reads on every request:`);
  const sessionsOwner = await owner.session.count();
  const sessionsApp = await app.session.count();
  console.log(`    owner sees ${sessionsOwner}, application sees ${sessionsApp}`);
  if (sessionsOwner !== sessionsApp) {
    console.log(`    ✗ Same problem — so even a successful login would not resolve a scope.`);
  }

  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });
