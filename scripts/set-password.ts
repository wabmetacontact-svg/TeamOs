/**
 * Sets a password from the command line.
 *
 * This exists because there is no "forgot password" email yet, and the hashes
 * in this workspace were carried over from the previous application — so the
 * password that works is whatever was set there, which may be nobody's
 * problem to remember any more.
 *
 *   npx tsx scripts/set-password.ts you@example.com                 generates one
 *   npx tsx scripts/set-password.ts you@example.com 'your password' sets that one
 *
 * It writes an argon2 hash, the same one the application produces, and records
 * an audit entry — a password changed outside the application is exactly the
 * kind of thing the audit log is for.
 *
 * Every existing session for that account is revoked, because a password
 * change that leaves old sessions alive has not really changed anything.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash as argonHash } from "@node-rs/argon2";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

/** Readable, and long enough that length does the work rather than punctuation. */
function generate(): string {
  const words = [
    "amber", "basalt", "cedar", "delta", "ember", "fjord", "gravel", "harbor",
    "indigo", "jasper", "kelp", "lantern", "marble", "nimbus", "onyx", "pewter",
    "quartz", "ripple", "slate", "tundra", "umber", "vellum", "willow", "zephyr",
  ];
  const pick = () => words[randomBytes(1)[0]! % words.length]!;
  return `${pick()}-${pick()}-${pick()}-${randomBytes(2).toString("hex")}`;
}

async function main() {
  const [rawEmail, given] = process.argv.slice(2);

  if (!rawEmail) {
    console.log("\n  Usage: npx tsx scripts/set-password.ts you@example.com ['new password']\n");
    return;
  }

  const email = rawEmail.trim().toLowerCase();
  const user = await db.user.findFirst({
    where: { email },
    include: { tenant: { select: { name: true } }, role: { select: { name: true } } },
  });

  if (!user) {
    console.log(`\n  No account with that address. Run scripts/check-login.ts to list them.\n`);
    return;
  }

  const password = given ?? generate();

  // The invitation form asks for ten; the same floor applies here.
  if (password.length < 10) {
    console.log(`\n  That password is ${password.length} characters. Use at least 10.\n`);
    return;
  }

  const passwordHash = await argonHash(password);

  const revoked = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;

    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

    // A password change that leaves old sessions alive has not changed much.
    const ended = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditEntry.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "password_reset",
        resourceType: "User",
        resourceId: user.id,
        resourceLabel: user.email,
        after: { by: "command line", sessionsRevoked: ended.count },
      },
    });

    return ended.count;
  });

  console.log(`\n  Password set for ${user.email}`);
  console.log(`    ${user.role.name} · ${user.tenant.name}`);
  if (revoked > 0) console.log(`    ${revoked} existing ${revoked === 1 ? "session" : "sessions"} revoked`);

  if (!given) {
    console.log(`\n    Password:  ${password}`);
    console.log(`\n  Shown once. Save it, then sign in at http://localhost:3000/login`);
  } else {
    console.log(`\n  Sign in at http://localhost:3000/login`);
  }

  if (["Owner", "Admin"].includes(user.role.name)) {
    console.log(`  You are ${user.role.name === "Owner" ? "an Owner" : "an Admin"}, so you will be asked to set up two-step next.`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
