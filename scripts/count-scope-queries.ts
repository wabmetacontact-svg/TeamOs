/**
 * How many SQL statements the per-request scope lookup really sends.
 *
 * It is one Prisma call with a deep include. By default Prisma resolves each
 * level of an include with its own query, so one call can be many statements —
 * and inside a transaction they run one after another, each paying a full
 * round trip.
 */
import { PrismaClient } from "@prisma/client";

const log: string[] = [];
const app = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: [{ emit: "event", level: "query" }],
});
(app as unknown as { $on: (e: "query", cb: (ev: { query: string }) => void) => void }).$on("query", (ev) =>
  log.push(ev.query.replace(/\s+/g, " ").slice(0, 70)),
);

async function main() {
  const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const tenant = await owner.tenant.findFirstOrThrow({ where: { slug: "hephaestus" } });
  await owner.$disconnect();

  const include = {
    tenant: { select: { id: true, name: true, baseCurrency: true, timezone: true, status: true } },
    user: {
      include: {
        role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
        scope: { select: { clientId: true } },
        contextScope: { select: { contextId: true } },
      },
    },
  } as const;

  for (const strategy of ["query", "join", undefined] as const) {
    log.length = 0;
    const started = performance.now();
    await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, TRUE)`;
      return tx.session.findFirst({ include, ...(strategy ? { relationLoadStrategy: strategy } : {}) });
    });
    const ms = performance.now() - started;
    console.log(`\n  relationLoadStrategy: "${strategy}"  →  ${log.length} statements, ${ms.toFixed(0)} ms`);
    for (const q of log) console.log(`     ${q}`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => app.$disconnect());
