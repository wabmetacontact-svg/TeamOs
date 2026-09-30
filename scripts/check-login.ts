/**
 * Why a login is being refused.
 *
 * "Wrong email or password" is deliberately the same message for a missing
 * account and a wrong password — that is what stops someone probing which
 * addresses exist. Useful in production, unhelpful when it is your own account,
 * so this says which of the two it actually is.
 *
 *   npx tsx scripts/check-login.ts you@example.com [password]
 *
 * With a password it tests the real verification path. Without one it only
 * reports what the account looks like.
 */
import { PrismaClient } from "@prisma/client";
import { verify as argonVerify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const [rawEmail, password] = process.argv.slice(2);

  if (!rawEmail) {
    console.log("\n  Usage: npx tsx scripts/check-login.ts you@example.com [password]\n");
    const all = await db.user.findMany({
      include: { tenant: { select: { name: true, status: true } }, role: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    console.log("  Accounts that exist:");
    for (const u of all) {
      console.log(`    ${u.email}  (${u.role.name}, ${u.status}, ${u.tenant.name})`);
    }
    console.log("");
    return;
  }

  // The login action lowercases and trims; anything else here would be testing
  // a different lookup than the one that runs.
  const email = rawEmail.trim().toLowerCase();
  console.log(`\n  Looking up: ${email}`);

  const user = await db.user.findFirst({
    where: { email },
    include: { tenant: { select: { name: true, status: true } }, role: { select: { name: true } } },
  });

  if (!user) {
    console.log(`  ✗ No account with that address.`);

    // Almost always a typo or a different address than they remember.
    const near = await db.user.findMany({ select: { email: true } });
    console.log(`\n  Addresses that do exist:`);
    for (const u of near) console.log(`    ${u.email}`);
    console.log("");
    return;
  }

  console.log(`  ✓ Account found`);
  console.log(`      tenant     ${user.tenant.name} (${user.tenant.status})`);
  console.log(`      role       ${user.role.name}`);
  console.log(`      status     ${user.status}`);
  console.log(`      2FA        ${user.twoFactorEnabled ? "on" : "off"}`);
  console.log(`      last login ${user.lastLoginAt?.toISOString() ?? "never"}`);

  const scheme = user.passwordHash.startsWith("$2") ? "bcrypt" : user.passwordHash.startsWith("$argon2") ? "argon2" : "unrecognised";
  console.log(`      password   ${scheme} (${user.passwordHash.length} chars)`);

  if (scheme === "unrecognised") {
    console.log(`\n  ✗ That hash is neither bcrypt nor argon2, so nothing can verify against it.`);
    console.log(`    Fix with: npx tsx scripts/set-password.ts ${email}\n`);
    return;
  }

  // The checks the login action makes after the password, in its order.
  if (user.status !== "Active") console.log(`\n  ✗ Account is ${user.status} — login is refused after the password check.`);
  if (user.tenant.status !== "Active") console.log(`\n  ✗ Workspace is ${user.tenant.status} — same.`);

  if (!password) {
    console.log(`\n  Pass a password as the second argument to test it.\n`);
    return;
  }

  const ok =
    scheme === "bcrypt"
      ? await bcrypt.compare(password, user.passwordHash)
      : await argonVerify(user.passwordHash, password).catch(() => false);

  if (ok) {
    console.log(`\n  ✓ That password is correct. Login should work.`);
    if (scheme === "bcrypt") console.log(`    It will be upgraded to argon2 automatically on the next sign-in.`);
    console.log("");
  } else {
    console.log(`\n  ✗ That password does not match the stored ${scheme} hash.`);
    console.log(`    The hash itself is well-formed, so this is the password, not the code.`);
    console.log(`    Set a new one with: npx tsx scripts/set-password.ts ${email}\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
