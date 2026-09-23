/**
 * Start fresh with real data.
 *
 *   npm run db:fresh -- --name "Jitesh" --email jitesh@yourcompany.com --password "yourpassword"
 *
 * Wipes every demo row and leaves exactly one manager account plus the default
 * expense categories, so the first real login has something sensible to pick.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_SOURCES } from "../src/lib/constants";

const db = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("name");
  const email = arg("email")?.toLowerCase();
  const password = arg("password");

  if (!name || !email || !password) {
    console.error(
      [
        "",
        "Usage:",
        '  npm run db:fresh -- --name "Your Name" --email you@company.com --password "at least 8 chars"',
        "",
        "This deletes ALL existing data and creates one manager account.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const counts = {
    tasks: await db.task.count(),
    transactions: await db.transaction.count(),
    salaries: await db.salary.count(),
    clients: await db.client.count(),
    users: await db.user.count(),
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total > 0 && !process.argv.includes("--yes")) {
    console.log("\nThis will permanently delete:");
    for (const [key, value] of Object.entries(counts)) console.log(`  ${value} ${key}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nType "delete" to continue: ')).trim();
    rl.close();
    if (answer !== "delete") {
      console.log("Cancelled. Nothing was deleted.");
      process.exit(0);
    }
  }

  await db.salary.deleteMany();
  await db.transaction.deleteMany();
  await db.task.deleteMany();
  await db.client.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();

  await db.user.create({
    data: { name, email, role: "MANAGER", passwordHash: await bcrypt.hash(password, 10) },
  });

  for (const categoryName of DEFAULT_EXPENSE_CATEGORIES) {
    await db.category.create({ data: { name: categoryName, kind: "EXPENSE" } });
  }
  for (const source of DEFAULT_INCOME_SOURCES) {
    await db.category.create({ data: { name: source, kind: "INCOME", color: "green" } });
  }

  console.log("\nDone. The workspace is empty and ready for real data.");
  console.log(`Sign in as ${email} and add your team in Settings.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
