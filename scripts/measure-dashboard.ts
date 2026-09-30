/**
 * What the dashboard actually costs, split into the part I control and the
 * part the network does.
 *
 * The performance gate was failing at ~1.6s against a 1.5s budget, and the
 * obvious fix — one transaction instead of twenty — made it *worse*, because
 * queries inside an interactive transaction share one connection and stop
 * running in parallel. That is the kind of result worth measuring properly
 * rather than guessing at twice.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function rtt(samples = 12): Promise<number> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    await db.$queryRaw`SELECT 1`;
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}

async function main() {
  console.log("\n  Measuring round-trip time to the database…");
  const oneTrip = await rtt();
  console.log(`    median SELECT 1:  ${oneTrip.toFixed(1)} ms`);

  // Twenty trivial queries, run in parallel, is the shape the dashboard has.
  const parallelStart = performance.now();
  await Promise.all(Array.from({ length: 20 }, () => db.$queryRaw`SELECT 1`));
  const parallel = performance.now() - parallelStart;

  // The same twenty, one after another, is the shape a transaction forces.
  const serialStart = performance.now();
  for (let i = 0; i < 20; i++) await db.$queryRaw`SELECT 1`;
  const serial = performance.now() - serialStart;

  console.log(`    20 in parallel:   ${parallel.toFixed(0)} ms`);
  console.log(`    20 in sequence:   ${serial.toFixed(0)} ms`);

  console.log(`\n  So the floor for a twenty-query page here is about ${parallel.toFixed(0)} ms,`);
  console.log(`  and inside a transaction it is about ${serial.toFixed(0)} ms.`);
  console.log(`\n  A Vercel function in the same region as Neon sees an RTT nearer 1–3 ms,`);
  console.log(`  which is ${(oneTrip / 2).toFixed(0)}–${(oneTrip / 30).toFixed(0)}× less than this machine.`);
  console.log(`  A wall-clock budget measured from here is therefore a measurement of`);
  console.log(`  the flight to Singapore, not of the code.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
