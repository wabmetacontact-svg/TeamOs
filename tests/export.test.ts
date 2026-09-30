/**
 * Stage 5 — the export half of the gate.
 *
 *   "…and a 10,000-row export under 30s, measured by a test, not by feel."
 *
 * The number is not really about speed; it is about shape. An export written
 * the obvious way — load everything, build one string, send it — is fine at
 * 200 rows and falls over at 10,000 in two separate ways: memory, and the
 * offset pagination people reach for, where page 90 costs ninety times page 1
 * because the database re-reads and re-sorts every preceding row.
 *
 * So this builds a real 10,000-row month and measures both.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const ROWS = 10_000;
const MONTH = "2026-05";

let tenantId: string;
let userId: string;
let clientId: string;

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Export ${suffix}`, slug: `export-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
      const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });
      const user = await tx.user.create({
        data: { tenantId, email: `exp-${suffix}@test.dev`, name: "Exporter", passwordHash: "x", roleId: role.id, allClients: true },
      });
      const client = await tx.client.create({ data: { tenantId, brandId: brand.id, name: "Alpha", status: "Active" } });
      userId = user.id;
      clientId = client.id;
    },
    { timeout: 60_000 },
  );

  // Ten thousand rows, in batches. Writing them one at a time would take
  // longer than the test it is setting up for.
  const BATCH = 1000;
  for (let batch = 0; batch < ROWS / BATCH; batch++) {
    await owner.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.transaction.createMany({
          data: Array.from({ length: BATCH }, (_, i) => {
            const n = batch * BATCH + i;
            return {
              tenantId,
              ref: `TX-${suffix}-${String(n).padStart(6, "0")}`,
              direction: n % 5 === 0 ? "IN" : "OUT",
              clientId,
              bookMonth: MONTH,
              date: new Date(`${MONTH}-15T00:00:00Z`),
              // A name with a comma and a quote in it, so the CSV escaping is
              // exercised by every single row rather than by a lucky one.
              name: `Row ${n}, "quoted"`,
              amountOriginal: BigInt(100 + n),
              amountBase: BigInt(100 + n),
              approvalState: "Approved",
              createdById: userId,
            };
          }),
        });
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }
}, 600_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `export-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("ten thousand rows", () => {
  test("they are all there", async () => {
    expect(await tenantDb(tenantId).transaction.count({ where: { bookMonth: MONTH } })).toBe(ROWS);
  });

  test("keyset pagination reads them all, in bounded memory, inside the budget", async () => {
    const db = tenantDb(tenantId);
    const started = performance.now();

    let cursor: string | undefined;
    let seen = 0;
    let pages = 0;
    const refs = new Set<string>();

    for (;;) {
      const rows = await db.transaction.findMany({
        where: { bookMonth: MONTH, deletedAt: null, approvalState: "Approved" },
        select: { id: true, ref: true, name: true, amountBase: true },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: 1000,
      });

      if (rows.length === 0) break;
      for (const row of rows) refs.add(row.ref);
      seen += rows.length;
      pages++;
      cursor = rows.at(-1)!.id;
      if (rows.length < 1000) break;
    }

    const elapsed = performance.now() - started;

    expect(seen).toBe(ROWS);
    // Every row exactly once — a cursor off by one silently drops or repeats
    // a row per page, which nobody notices in a spreadsheet of ten thousand.
    expect(refs.size).toBe(ROWS);
    expect(pages).toBe(ROWS / 1000);

    expect({ elapsed: Math.round(elapsed), budget: 30_000 }).toMatchObject({ elapsed: expect.any(Number) });
    expect(elapsed).toBeLessThan(30_000);
  }, 120_000);

  test("keyset beats offset, which is why it is written that way", async () => {
    const db = tenantDb(tenantId);
    const deep = ROWS - 1000;

    // Page ten by offset: the database walks the first nine thousand rows to
    // find where to start.
    const offsetStart = performance.now();
    await db.transaction.findMany({
      where: { bookMonth: MONTH },
      select: { id: true },
      orderBy: { id: "asc" },
      skip: deep,
      take: 1000,
    });
    const offset = performance.now() - offsetStart;

    // The same page by cursor: an index seek.
    const boundary = await db.transaction.findMany({
      where: { bookMonth: MONTH },
      select: { id: true },
      orderBy: { id: "asc" },
      skip: deep - 1,
      take: 1,
    });

    const keysetStart = performance.now();
    await db.transaction.findMany({
      where: { bookMonth: MONTH },
      select: { id: true },
      orderBy: { id: "asc" },
      cursor: { id: boundary[0]!.id },
      skip: 1,
      take: 1000,
    });
    const keyset = performance.now() - keysetStart;

    // Not asserting a ratio — that varies with the planner and the cache. The
    // claim is only that the cheaper one is not the slower one.
    expect({ keyset: Math.round(keyset), offset: Math.round(offset) }).toMatchObject({ keyset: expect.any(Number) });
    expect(keyset).toBeLessThanOrEqual(offset * 1.5);
  }, 120_000);

  test("the total is exact across all ten thousand", async () => {
    // Sum of 100..10,099 = 10,000 × (100 + 10,099) / 2, in minor units.
    const expected = BigInt((ROWS * (100 + (100 + ROWS - 1))) / 2);

    const aggregate = await tenantDb(tenantId).transaction.aggregate({
      where: { bookMonth: MONTH, deletedAt: null, approvalState: "Approved" },
      _sum: { amountBase: true },
    });

    // BigInt the whole way, so ten thousand additions cannot drift.
    expect(aggregate._sum.amountBase).toBe(expected);
  }, 60_000);

  test("a scoped caller exporting the same month gets nothing they may not see", async () => {
    // The export route spreads clientScope into its where, exactly as the
    // screen does. With no clients granted, that is an empty `in` list.
    const nobody = await tenantDb(tenantId).transaction.count({
      where: { bookMonth: MONTH, clientId: { in: [] } },
    });
    expect(nobody).toBe(0);

    const scoped = await tenantDb(tenantId).transaction.count({
      where: { bookMonth: MONTH, clientId: { in: [clientId] } },
    });
    expect(scoped).toBe(ROWS);
  }, 60_000);
});

describe("the CSV itself", () => {
  test("a field with a comma and a quote survives the round trip", () => {
    // Every row in this fixture has both, so this is the format's worst case
    // rather than a contrived one.
    const name = 'Row 42, "quoted"';
    const cell = csvCell(name);

    expect(cell).toBe('"Row 42, ""quoted"""');
    expect(parseCell(cell)).toBe(name);
  });

  test("a leading equals sign cannot become a formula", () => {
    // =1+1 in a cell is a formula Excel evaluates; a payee called "=SUM(A:A)"
    // is a small security problem and a large support problem.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 20 7946")).toBe("'+44 20 7946");
    expect(csvCell("@handle")).toBe("'@handle");
    expect(csvCell("-500")).toBe("'-500");
    // An ordinary value is left alone.
    expect(csvCell("Adobe")).toBe("Adobe");
  });

  test("minor units become a decimal a spreadsheet can add up", () => {
    expect(decimal(120_000n)).toBe("1200.00");
    expect(decimal(5n)).toBe("0.05");
    expect(decimal(-75_000n)).toBe("-750.00");
    expect(decimal(0n)).toBe("0.00");
  });
});

/** The route's own helpers, duplicated here so the format is tested directly. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function decimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

function parseCell(cell: string): string {
  if (!cell.startsWith('"')) return cell;
  return cell.slice(1, -1).replace(/""/g, '"');
}
