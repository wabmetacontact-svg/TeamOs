/**
 * Stage 3 acceptance gate — the ledger.
 *
 * The plan asks for four things, and they are the four ways a finance module
 * loses somebody's trust:
 *
 *   "Reconciliation: a CSV of last month's real MonthBook data imports, and
 *    per-client per-month totals match the sheet **exactly**. A write to a
 *    closed month is refused by the database trigger, not only by the
 *    application. An approved expense edited writes a before/after audit entry.
 *    A rate change today does not move last month's figures."
 *
 * The last one is the quietest and the worst. If totals are recomputed from a
 * live rate, then every historical figure moves whenever the rupee does, and
 * nobody can reproduce a number they quoted a month ago.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { convert, divideRoundHalfUp, formatMoney, parseAmount, sum, toInput } from "../src/lib/money";
import { monthTotals } from "../src/lib/transactions";
import type { Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let userId: string;
let clientA: string;
let clientB: string;
let categoryId: string;

function everyone(): Scope {
  return {
    userId,
    tenantId,
    roleName: "Admin",
    permissions: new Set(["expense:view", "expense:create", "expense:edit", "expense:approve", "book_month:close"]),
    allClients: true,
    clientIds: [],
    allContexts: true,
    contextIds: [],
  };
}

async function addTransaction(data: {
  clientId: string;
  bookMonth: string;
  direction?: string;
  amountBase: bigint;
  amountOriginal?: bigint;
  currency?: string;
  rate?: string;
  approvalState?: string;
  ref?: string;
}) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.transaction.create({
      data: {
        tenantId,
        ref: data.ref ?? `TX-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
        direction: data.direction ?? "OUT",
        clientId: data.clientId,
        bookMonth: data.bookMonth,
        date: new Date(`${data.bookMonth}-15T00:00:00Z`),
        categoryId,
        name: "Entry",
        amountOriginal: data.amountOriginal ?? data.amountBase,
        currencyOriginal: data.currency ?? "INR",
        exchangeRate: data.rate ?? "1",
        amountBase: data.amountBase,
        approvalState: data.approvalState ?? "Approved",
        createdById: userId,
      },
    });
  });
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Ledger ${suffix}`, slug: `ledger-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const brand = await tx.brand.create({ data: { tenantId, name: "ARC3" } });
      const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
      const user = await tx.user.create({
        data: { tenantId, email: `fin-${suffix}@test.dev`, name: "Finance", passwordHash: "x", roleId: role.id, allClients: true },
      });
      userId = user.id;

      const [a, b] = await Promise.all([
        tx.client.create({ data: { tenantId, brandId: brand.id, name: "Alpha", status: "Active" } }),
        tx.client.create({ data: { tenantId, brandId: brand.id, name: "Beta", status: "Active" } }),
      ]);
      clientA = a.id;
      clientB = b.id;

      const category = await tx.category.create({ data: { tenantId, name: "Software", direction: "OUT" } });
      categoryId = category.id;
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `ledger-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("money never touches a float", () => {
  test("the amounts people actually type all parse", () => {
    expect(parseAmount("1200", "INR")).toBe(120_000n);
    expect(parseAmount("1,20,000", "INR")).toBe(12_000_000n);
    expect(parseAmount("₹1200.50", "INR")).toBe(120_050n);
    expect(parseAmount("1 200", "INR")).toBe(120_000n);
    expect(parseAmount("(500)", "INR")).toBe(-50_000n);
    expect(parseAmount("-500", "INR")).toBe(-50_000n);
  });

  test("rounding is half-up on the string, so 0.1 arithmetic never happens", () => {
    // 10.999 at two places is 1100, not 1099. A float would have made this
    // 10.998999999999999 and truncated.
    expect(parseAmount("10.999", "INR")).toBe(1100n);
    expect(parseAmount("10.994", "INR")).toBe(1099n);
    expect(parseAmount("0.005", "INR")).toBe(1n);
    expect(parseAmount("0.004", "INR")).toBe(0n);
  });

  test("a currency with no minor unit is not given one", () => {
    // ¥1200 is 1200 minor units. Multiplying by 100 would invent sen.
    expect(parseAmount("1200", "JPY")).toBe(1200n);
    expect(toInput(1200n, "JPY")).toBe("1200");
    expect(toInput(120_000n, "INR")).toBe("1200.00");
  });

  test("nonsense returns null rather than zero", () => {
    // A zero here would be a silently wrong entry, which is worse than a
    // rejected one.
    for (const bad of ["", "abc", ".", "1.2.3", "--5", "   "]) {
      expect(parseAmount(bad, "INR")).toBeNull();
    }
  });

  test("adding a column stays exact at a scale a float would drift at", () => {
    // 10,000 rows of ₹0.01. In floats this lands near 99.99999999999859.
    const amounts = Array.from({ length: 10_000 }, () => 1n);
    expect(sum(amounts)).toBe(10_000n);
    expect(toInput(sum(amounts), "INR")).toBe("100.00");
  });

  test("display groups the Indian way, because the books are", () => {
    expect(formatMoney(12_000_000n, "INR")).toBe("₹1,20,000.00");
    expect(formatMoney(12_000_000n, "INR", { compact: true })).toBe("₹1.2L");
    expect(formatMoney(-50_000n, "INR")).toContain("500.00");
    expect(formatMoney(null)).toBe("—");
  });

  test("integer division rounds half away from zero", () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
  });
});

describe("a rate change does not move last month's figures", () => {
  test("conversion happens once, at the rate given, and is stored", async () => {
    // $1,000 at 83.50, entered in August.
    const august = await addTransaction({
      clientId: clientA,
      bookMonth: "2026-08",
      amountOriginal: 100_000n,
      currency: "USD",
      rate: "83.50",
      amountBase: convert(100_000n, "83.50", "USD", "INR"),
    });

    expect(august.amountBase).toBe(8_350_000n); // ₹83,500.00

    const before = await monthTotals(everyone(), { clientId: clientA, bookMonth: "2026-08" });
    expect(before.spend).toBe(8_350_000n);

    // The rupee moves. A new entry uses the new rate…
    const september = await addTransaction({
      clientId: clientA,
      bookMonth: "2026-09",
      amountOriginal: 100_000n,
      currency: "USD",
      rate: "89.00",
      amountBase: convert(100_000n, "89.00", "USD", "INR"),
    });
    expect(september.amountBase).toBe(8_900_000n);

    // …and August has not moved. This is the whole point of storing amountBase
    // rather than recomputing it: August's row holds August's answer.
    const after = await monthTotals(everyone(), { clientId: clientA, bookMonth: "2026-08" });
    expect(after.spend).toBe(8_350_000n);
    expect(after.spend).toBe(before.spend);

    const stored = await tenantDb(tenantId).transaction.findUniqueOrThrow({ where: { id: august.id } });
    expect(stored.amountBase).toBe(8_350_000n);
    expect(stored.exchangeRate.toString()).toBe("83.5");
  });

  test("conversion is exact across minor-unit differences", () => {
    // ¥10,000 (10000 minor units, no decimals) at 0.56 → ₹5,600.00
    expect(convert(10_000n, "0.56", "JPY", "INR")).toBe(560_000n);
    // Same currency is a no-op, not a round trip that could drift.
    expect(convert(123_456n, "1", "INR", "INR")).toBe(123_456n);
    expect(convert(123_456n, "99.9", "INR", "INR")).toBe(123_456n);
  });
});

describe("per-client per-month totals reconcile exactly", () => {
  test("a month of entries sums to the figure the sheet would show", async () => {
    // A February that looks like a real one: several rows, two clients, some
    // income, one row that is still a draft.
    const february = [
      { clientId: clientA, amountBase: 4_500_000n, direction: "OUT" },
      { clientId: clientA, amountBase: 1_299_900n, direction: "OUT" },
      { clientId: clientA, amountBase: 75_000n, direction: "OUT" },
      { clientId: clientA, amountBase: 25_000_000n, direction: "IN" },
      { clientId: clientB, amountBase: 8_000_000n, direction: "OUT" },
      { clientId: clientB, amountBase: 12_000_000n, direction: "IN" },
    ];

    for (const row of february) await addTransaction({ ...row, bookMonth: "2026-02" });
    // A draft, which must not be in the total.
    await addTransaction({ clientId: clientA, bookMonth: "2026-02", amountBase: 999_999n, approvalState: "Draft" });

    const alpha = await monthTotals(everyone(), { clientId: clientA, bookMonth: "2026-02" });
    expect(alpha.spend).toBe(4_500_000n + 1_299_900n + 75_000n);
    expect(alpha.income).toBe(25_000_000n);
    expect(alpha.net).toBe(25_000_000n - 5_874_900n);

    const beta = await monthTotals(everyone(), { clientId: clientB, bookMonth: "2026-02" });
    expect(beta.spend).toBe(8_000_000n);
    expect(beta.income).toBe(12_000_000n);

    // And the two clients together, which is the workspace figure.
    const both = await monthTotals(everyone(), { bookMonth: "2026-02" });
    expect(both.spend).toBe(alpha.spend + beta.spend);
    expect(both.income).toBe(alpha.income + beta.income);
  });

  test("an unapproved row is out of the total until somebody approves it", async () => {
    const before = await monthTotals(everyone(), { clientId: clientA, bookMonth: "2026-02" });
    const withDrafts = await monthTotals(everyone(), { clientId: clientA, bookMonth: "2026-02", includeUnapproved: true });

    expect(withDrafts.spend).toBe(before.spend + 999_999n);
    // A total that counts money nobody approved is not a total anybody can
    // take to a client.
    expect(before.spend).not.toBe(withDrafts.spend);
  });

  test("a soft-deleted row leaves the total, and the row stays", async () => {
    const doomed = await addTransaction({ clientId: clientB, bookMonth: "2026-03", amountBase: 500_000n });
    expect((await monthTotals(everyone(), { clientId: clientB, bookMonth: "2026-03" })).spend).toBe(500_000n);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.transaction.update({ where: { id: doomed.id }, data: { deletedAt: new Date() } });
    });

    expect((await monthTotals(everyone(), { clientId: clientB, bookMonth: "2026-03" })).spend).toBe(0n);
    // Still findable, for whoever asks why March moved.
    expect(await tenantDb(tenantId).transaction.findUnique({ where: { id: doomed.id } })).not.toBeNull();
  });

  test("totals respect client scope, so a restricted view still adds up correctly", async () => {
    const restricted: Scope = { ...everyone(), allClients: false, clientIds: [clientB] };

    const theirs = await monthTotals(restricted, { bookMonth: "2026-02" });
    expect(theirs.spend).toBe(8_000_000n);
    expect(theirs.rows.every((r) => r.clientId === clientB)).toBe(true);
  });
});

describe("a closed month is enforced by the database", () => {
  test("the trigger refuses an insert, not the application", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.bookMonth.create({
        data: { tenantId, clientId: clientA, month: "2026-01", state: "Closed", closedAt: new Date(), closedById: userId },
      });
    });

    // Straight to the database, bypassing every check in the application —
    // which is what an import script or an admin console would do.
    await expect(addTransaction({ clientId: clientA, bookMonth: "2026-01", amountBase: 100n })).rejects.toThrow(
      /closed/i,
    );
  });

  test("it refuses an edit to a row already in a closed month", async () => {
    const row = await addTransaction({ clientId: clientA, bookMonth: "2026-04", amountBase: 100_000n });

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.bookMonth.create({
        data: { tenantId, clientId: clientA, month: "2026-04", state: "Closed", closedAt: new Date(), closedById: userId },
      });
    });

    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.transaction.update({ where: { id: row.id }, data: { amountBase: 999n } });
      }),
    ).rejects.toThrow(/closed/i);
  });

  test("it refuses moving a row out of a closed month, which would change its total too", async () => {
    const row = await tenantDb(tenantId).transaction.findFirstOrThrow({ where: { bookMonth: "2026-04" } });

    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.transaction.update({ where: { id: row.id }, data: { bookMonth: "2026-05" } });
      }),
    ).rejects.toThrow(/closed/i);
  });

  test("it refuses a soft delete from a closed month", async () => {
    const row = await tenantDb(tenantId).transaction.findFirstOrThrow({ where: { bookMonth: "2026-04" } });

    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.transaction.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      }),
    ).rejects.toThrow(/closed/i);
  });

  test("another client's same month is unaffected — closing is per client", async () => {
    // Alpha's January is closed. Beta's is not, and must still accept entries.
    const row = await addTransaction({ clientId: clientB, bookMonth: "2026-01", amountBase: 100_000n });
    expect(row.bookMonth).toBe("2026-01");
  });

  test("reopening lets the month move again", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.bookMonth.update({
        where: { clientId_month: { clientId: clientA, month: "2026-01" } },
        data: { state: "Open", reopenReason: "Invoice arrived late" },
      });
    });

    const row = await addTransaction({ clientId: clientA, bookMonth: "2026-01", amountBase: 100n });
    expect(row.amountBase).toBe(100n);
  });

  test("the escape hatch exists for offboarding and nothing else opens it", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.bookMonth.update({
        where: { clientId_month: { clientId: clientA, month: "2026-04" } },
        data: { state: "Closed" },
      });
    });

    const row = await tenantDb(tenantId).transaction.findFirstOrThrow({ where: { bookMonth: "2026-04" } });

    // Owner credentials alone are not enough — the trigger does not care who
    // is asking.
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.transaction.delete({ where: { id: row.id } });
      }),
    ).rejects.toThrow(/closed/i);

    // With the setting, which only the purge path sets.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
      await tx.transaction.delete({ where: { id: row.id } });
    });

    expect(await tenantDb(tenantId).transaction.findUnique({ where: { id: row.id } })).toBeNull();
  });
});
