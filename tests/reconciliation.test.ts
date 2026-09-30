/**
 * Stage 7 acceptance gate — migration and cutover.
 *
 *   "Totals per client per month match the source sheets exactly. Historical
 *    expenses import as Approved **flagged as inferred**. One full month runs
 *    in parallel with the new platform as the system of record before the
 *    sheets go read-only."
 *
 * The third part is a process and cannot be tested — it is somebody running
 * both for a month. The first two are arithmetic and a flag, and both are
 * here.
 *
 * "Exactly" is the word doing the work. A reconciliation that accepts "close
 * enough" is how a rounding bug survives a cutover and turns up a year later
 * in a figure somebody has already quoted.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { differences, inferredApprovals, progress, rowsBehind } from "../src/lib/reconciliation";
import { NotFoundError, type Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const MONTH = "2026-03";

let tenantId: string;
let userId: string;
let clientA: string;
let clientB: string;

function scopeFor(clientIds?: string[]): Scope {
  return {
    userId,
    tenantId,
    roleName: clientIds ? "Manager" : "Admin",
    permissions: new Set(["expense:view", "expense:edit", "expense:approve"]),
    allClients: clientIds === undefined,
    clientIds: clientIds ?? [],
    allContexts: true,
    contextIds: [],
  };
}

async function record(clientId: string, month: string, income: bigint, spend: bigint) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.reconciliation.upsert({
      where: { clientId_month: { clientId, month } },
      create: {
        tenantId,
        clientId,
        month,
        expectedIncome: income,
        expectedSpend: spend,
        source: "sheet.xlsx",
        recordedById: userId,
      },
      update: { expectedIncome: income, expectedSpend: spend },
    });
  });
}

async function entry(clientId: string, month: string, direction: string, amount: bigint, opts: { state?: string; inferred?: boolean } = {}) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.transaction.create({
      data: {
        tenantId,
        ref: `TX-${suffix}-${Math.random().toString(36).slice(2, 9)}`,
        direction,
        clientId,
        bookMonth: month,
        date: new Date(`${month}-15T00:00:00Z`),
        name: "Imported row",
        amountOriginal: amount,
        amountBase: amount,
        approvalState: opts.state ?? "Approved",
        approvalInferred: opts.inferred ?? false,
        createdById: userId,
      },
    });
  });
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Recon ${suffix}`, slug: `recon-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
    const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });
    const user = await tx.user.create({
      data: { tenantId, email: `rec-${suffix}@test.dev`, name: "Recon", passwordHash: "x", roleId: role.id, allClients: true },
    });
    userId = user.id;

    const [a, b] = await Promise.all([
      tx.client.create({ data: { tenantId, brandId: brand.id, name: "Alpha", status: "Active" } }),
      tx.client.create({ data: { tenantId, brandId: brand.id, name: "Beta", status: "Active" } }),
    ]);
    clientA = a.id;
    clientB = b.id;
  });
}, 120_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `recon-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("a month that reconciles exactly", () => {
  test("matching to the paisa is a match; one paisa out is not", async () => {
    // The sheet says: income 2,50,000.00, spend 57,999.00
    await record(clientA, MONTH, 25_000_000n, 5_799_900n);

    await entry(clientA, MONTH, "IN", 25_000_000n);
    await entry(clientA, MONTH, "OUT", 4_500_000n);
    await entry(clientA, MONTH, "OUT", 1_299_900n);

    const [row] = await differences(scopeFor(), { month: MONTH });

    expect(row!.actualIncome).toBe(25_000_000n);
    expect(row!.actualSpend).toBe(5_799_900n);
    expect(row!.incomeDelta).toBe(0n);
    expect(row!.spendDelta).toBe(0n);
    expect(row!.matches).toBe(true);

    // One paisa. "Close enough" is how a rounding bug survives a cutover.
    await record(clientA, MONTH, 25_000_000n, 5_799_901n);
    const [off] = await differences(scopeFor(), { month: MONTH });
    expect(off!.matches).toBe(false);
    expect(off!.spendDelta).toBe(-1n);

    await record(clientA, MONTH, 25_000_000n, 5_799_900n);
  });

  test("the delta says which way, so a difference can be chased", async () => {
    // Platform has 1,000.00 more spend than the sheet: something imported
    // twice, or the sheet missed a row.
    await record(clientB, MONTH, 0n, 500_000n);
    await entry(clientB, MONTH, "OUT", 600_000n);

    const row = (await differences(scopeFor(), { month: MONTH })).find((r) => r.clientId === clientB)!;

    expect(row.spendDelta).toBe(100_000n);
    expect(row.spendDelta > 0n).toBe(true); // platform has more than the sheet
  });
});

describe("unapproved rows are reported, not folded in", () => {
  test("a draft is outside the total and counted separately", async () => {
    await entry(clientB, MONTH, "OUT", 250_000n, { state: "Draft" });

    const row = (await differences(scopeFor(), { month: MONTH })).find((r) => r.clientId === clientB)!;

    // The total has not moved…
    expect(row.actualSpend).toBe(600_000n);
    // …and the gap is visible rather than silently missing. A month short by
    // exactly the value of its drafts is not a mismatch, it is a month
    // somebody has not finished approving.
    expect(row.unapproved).toBe(1);
    expect(row.unapprovedValue).toBe(250_000n);
  });

  test("a submitted row counts the same way as a draft", async () => {
    await entry(clientB, MONTH, "OUT", 100_000n, { state: "Submitted" });

    const row = (await differences(scopeFor(), { month: MONTH })).find((r) => r.clientId === clientB)!;
    expect(row.unapproved).toBe(2);
    expect(row.unapprovedValue).toBe(350_000n);
  });
});

describe("historical rows are flagged as inferred", () => {
  test("an imported approval is distinguishable from one somebody made", async () => {
    await record(clientA, "2025-11", 0n, 1_000_000n);
    await entry(clientA, "2025-11", "OUT", 1_000_000n, { inferred: true });

    const inferred = await inferredApprovals(scopeFor());

    // Without this, a row that arrived already settled from a spreadsheet
    // reads exactly like one a person looked at and approved.
    expect(inferred.count).toBeGreaterThanOrEqual(1);
    expect(inferred.value).toBeGreaterThanOrEqual(1_000_000n);
    expect(inferred.byMonth.some((m) => m.month === "2025-11")).toBe(true);
  });

  test("an ordinary approval is not flagged", async () => {
    const before = await inferredApprovals(scopeFor(), MONTH);
    await entry(clientA, MONTH, "OUT", 1n);
    const after = await inferredApprovals(scopeFor(), MONTH);

    expect(after.count).toBe(before.count);
  });

  test("an inferred row still counts toward the total it belongs to", async () => {
    // Flagged is not excluded. The money was spent; only the approval is
    // inferred.
    const rows = await rowsBehind(scopeFor(), clientA, "2025-11");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.approvalInferred).toBe(true);
    expect(rows[0]!.approvalState).toBe("Approved");

    const row = (await differences(scopeFor(), { month: "2025-11" })).find((r) => r.clientId === clientA)!;
    expect(row.actualSpend).toBe(1_000_000n);
  });
});

describe("settling a month", () => {
  test("a difference of zero is not the same as being settled", async () => {
    const row = (await differences(scopeFor(), { month: MONTH })).find((r) => r.clientId === clientA)!;

    // Two identical mistakes agree with each other. A reconciliation is
    // finished because somebody says so, not because the numbers match.
    expect(row.resolvedAt).toBeNull();
    expect(row.resolvedBy).toBeNull();
  });

  test("resolving records who and what the figures were at the time", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.reconciliation.update({
        where: { clientId_month: { clientId: clientB, month: MONTH } },
        data: { resolvedAt: new Date(), resolvedById: userId, note: "Sheet missed the March courier" },
      });
    });

    const row = (await differences(scopeFor(), { month: MONTH })).find((r) => r.clientId === clientB)!;

    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolvedBy).toBe("Recon");
    // Settled *with* a difference, explained — which is the normal outcome,
    // not a failure.
    expect(row.matches).toBe(false);
    expect(row.note).toContain("courier");
  });

  test("unresolvedOnly leaves the settled ones out", async () => {
    const open = await differences(scopeFor(), { month: MONTH, unresolvedOnly: true });
    expect(open.some((r) => r.clientId === clientB)).toBe(false);
    expect(open.some((r) => r.clientId === clientA)).toBe(true);
  });
});

describe("how far through the cutover the workspace is", () => {
  test("a month with entries and no expectation is counted as unchecked", async () => {
    // The state that quietly passes for done: imported, never compared.
    await entry(clientA, "2025-09", "OUT", 999n);

    const state = await progress(scopeFor());

    expect(state.unchecked).toBeGreaterThan(0);
    expect(state.uncheckedRows).toBeGreaterThan(0);
    expect(state.recorded).toBeGreaterThan(0);
    expect(state.outstanding).toBe(state.recorded - state.resolved);
  });
});

describe("it is scoped like everything else", () => {
  test("a Manager sees only their own clients' reconciliations", async () => {
    const scoped = scopeFor([clientA]);
    const rows = await differences(scoped);

    expect(rows.every((r) => r.clientId === clientA)).toBe(true);
    const serialised = JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(serialised).not.toContain("Beta");
  });

  test("the rows behind a client they cannot reach are refused", async () => {
    await expect(rowsBehind(scopeFor([clientA]), clientB, MONTH)).rejects.toThrow(NotFoundError);
    await expect(rowsBehind(scopeFor([clientA]), clientA, MONTH)).resolves.toBeTruthy();
  });

  test("the inferred count is scoped too", async () => {
    const all = await inferredApprovals(scopeFor());
    const scoped = await inferredApprovals(scopeFor([clientB]));

    expect(scoped.count).toBeLessThan(all.count);
  });

  test("progress is scoped, so a Manager sees their own cutover", async () => {
    const all = await progress(scopeFor());
    const scoped = await progress(scopeFor([clientA]));

    expect(scoped.recorded).toBeLessThan(all.recorded);
  });
});

describe("the reconciliation table is isolated", () => {
  test("it is not visible without a tenant", async () => {
    const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      // A new tenant-owned table that shipped without a policy would show up
      // here as a row count above zero.
      expect(await app.reconciliation.count()).toBe(0);
      expect(await tenantDb(tenantId).reconciliation.count()).toBeGreaterThan(0);
    } finally {
      await app.$disconnect();
    }
  });
});
