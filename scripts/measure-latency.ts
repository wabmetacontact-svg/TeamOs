/**
 * Where the time goes on a click.
 *
 * Every page render does the same things before it does anything of its own:
 * resolve the session and scope, and load the notification bell. Each of those
 * is a database query, and each query through tenantDb is wrapped in a
 * transaction to set app.tenant_id. This measures what that costs from here,
 * so the fix is chosen from numbers rather than from a guess.
 */
import { PrismaClient } from "@prisma/client";

const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function bound(tenantId: string) {
  return app.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await app.$transaction([
          app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
          query(args),
        ]);
        return result;
      },
    },
  });
}

async function median(label: string, fn: () => Promise<unknown>, runs = 8): Promise<number> {
  await fn(); // warm the connection
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const m = times[Math.floor(times.length / 2)]!;
  console.log(`  ${label.padEnd(52)} ${m.toFixed(0).padStart(5)} ms`);
  return m;
}

async function main() {
  const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const tenant = await owner.tenant.findFirstOrThrow({ where: { slug: "hephaestus" } });
  await owner.$disconnect();

  const db = bound(tenant.id);
  console.log("\n  From this machine to the database:\n");

  const trip = await median("one round trip (SELECT 1)", () => app.$queryRaw`SELECT 1`);
  const single = await median("one query through tenantDb", () => db.user.findFirst());

  const tx = await median("same query, one explicit transaction", () =>
    app.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, TRUE)`;
      return t.user.findFirst();
    }),
  );

  console.log(`\n  So one tenantDb query costs about ${(single / trip).toFixed(1)} round trips.\n`);

  // What the layout does on every single page, before the page's own work.
  console.log("  What every page does before its own work:\n");
  const layout = await median("session + scope + bell (as the layout runs them)", () =>
    Promise.all([
      db.session.findFirst({
        include: {
          tenant: true,
          user: { include: { role: { include: { permissions: { include: { permission: true } } } }, scope: true, contextScope: true } },
        },
      }),
      db.notification.findMany({ take: 8 }),
      db.notification.count(),
    ]),
  );

  console.log(`\n  Round trip ${trip.toFixed(0)} ms · per query ${single.toFixed(0)} ms · layout ${layout.toFixed(0)} ms per click.`);
  console.log(`  In one transaction instead: ${tx.toFixed(0)} ms per query.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => app.$disconnect());
