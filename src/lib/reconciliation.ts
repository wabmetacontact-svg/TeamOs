import "server-only";
import { tenantDb } from "./db";
import { getClient } from "./clients";
import { clientScope, type Scope } from "./scope";

/**
 * Checking the platform's figures against the sheets they came from.
 *
 * Cutover is the one moment when two numbers for the same month are produced
 * independently, and the only honest way to know an import worked is to
 * compare them. Not "does the import look right" — does this client's May come
 * to the same total in both places, to the paisa.
 *
 * Three things make a difference explainable rather than just visible:
 *
 * The comparison is per client per month, because that is the unit somebody
 * can actually investigate. A workspace-wide difference of ₹4,230 tells you
 * nothing; the same difference on one client in one month is usually one row.
 *
 * Unapproved entries are reported separately rather than folded in. A month
 * that is short by exactly the value of its drafts is not a mismatch, it is a
 * month somebody has not finished approving.
 *
 * And a reconciliation is finished when somebody says so, not when the numbers
 * match. A difference of zero on a month where half the rows are missing from
 * both sides is not agreement, it is two identical mistakes.
 */

export type Difference = {
  clientId: string;
  clientName: string;
  month: string;

  expectedIncome: bigint;
  expectedSpend: bigint;
  actualIncome: bigint;
  actualSpend: bigint;

  /** actual − expected. Positive means the platform has more than the sheet. */
  incomeDelta: bigint;
  spendDelta: bigint;

  /** Rows in the month that no total counts yet. */
  unapproved: number;
  unapprovedValue: bigint;

  entries: number;
  matches: boolean;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  note: string | null;
  source: string | null;
  recordedBy: string;
};

/**
 * Every recorded expectation, compared against what the ledger now holds.
 *
 * Scoped like every other read: a Manager reconciling their own clients sees
 * their own clients.
 */
export async function differences(scope: Scope, filters: { month?: string; unresolvedOnly?: boolean } = {}) {
  const db = tenantDb(scope.tenantId);

  const recorded = await db.reconciliation.findMany({
    where: {
      ...(scope.allClients ? {} : { clientId: { in: [...scope.clientIds] } }),
      ...(filters.month ? { month: filters.month } : {}),
      ...(filters.unresolvedOnly ? { resolvedAt: null } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      recordedBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
    orderBy: [{ month: "desc" }, { client: { name: "asc" } }],
  });

  if (recorded.length === 0) return [];

  const months = [...new Set(recorded.map((r) => r.month))];
  const clientIds = [...new Set(recorded.map((r) => r.clientId))];

  // Two groupings rather than one per row: a query per client-month is how a
  // reconciliation screen for a year becomes four hundred round trips.
  const [approved, pending] = await Promise.all([
    db.transaction.groupBy({
      by: ["clientId", "bookMonth", "direction"],
      where: {
        ...clientScope(scope),
        clientId: { in: clientIds },
        bookMonth: { in: months },
        deletedAt: null,
        approvalState: "Approved",
      },
      _sum: { amountBase: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["clientId", "bookMonth"],
      where: {
        ...clientScope(scope),
        clientId: { in: clientIds },
        bookMonth: { in: months },
        deletedAt: null,
        approvalState: { in: ["Draft", "Submitted"] },
      },
      _sum: { amountBase: true },
      _count: { _all: true },
    }),
  ]);

  const key = (clientId: string, month: string) => `${clientId}:${month}`;

  const actual = new Map<string, { income: bigint; spend: bigint; entries: number }>();
  for (const row of approved) {
    const k = key(row.clientId, row.bookMonth);
    const entry = actual.get(k) ?? { income: 0n, spend: 0n, entries: 0 };
    const total = row._sum.amountBase ?? 0n;
    if (row.direction === "IN") entry.income += total;
    else entry.spend += total;
    entry.entries += row._count._all;
    actual.set(k, entry);
  }

  const waiting = new Map(
    pending.map((row) => [
      key(row.clientId, row.bookMonth),
      { count: row._count._all, value: row._sum.amountBase ?? 0n },
    ]),
  );

  return recorded.map((row): Difference => {
    const found = actual.get(key(row.clientId, row.month)) ?? { income: 0n, spend: 0n, entries: 0 };
    const unapproved = waiting.get(key(row.clientId, row.month)) ?? { count: 0, value: 0n };

    const incomeDelta = found.income - row.expectedIncome;
    const spendDelta = found.spend - row.expectedSpend;

    return {
      clientId: row.clientId,
      clientName: row.client.name,
      month: row.month,
      expectedIncome: row.expectedIncome,
      expectedSpend: row.expectedSpend,
      actualIncome: found.income,
      actualSpend: found.spend,
      incomeDelta,
      spendDelta,
      unapproved: unapproved.count,
      unapprovedValue: unapproved.value,
      entries: found.entries,
      // Exactly zero, both directions. "Close enough" is how a rounding bug
      // survives a cutover.
      matches: incomeDelta === 0n && spendDelta === 0n,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy?.name ?? null,
      note: row.note,
      source: row.source,
      recordedBy: row.recordedBy.name,
    };
  });
}

/** The rows behind one client-month, for working out where a difference is. */
export async function rowsBehind(scope: Scope, clientId: string, month: string) {
  const db = tenantDb(scope.tenantId);

  // Through getClient rather than a query of its own. The first version of
  // this line was `{ ...clientIdScope(scope), id: clientId }` — the exact
  // spread that let a caller's id replace the scope's own key in clients and
  // then in contexts. Written a third time, in a function that exists to show
  // a Manager the rows behind a number. Reusing the one function that already
  // gets this right is the only fix that stays fixed.
  await getClient(scope, clientId);

  return db.transaction.findMany({
    where: { ...clientScope(scope), clientId, bookMonth: month, deletedAt: null },
    include: {
      category: { select: { name: true } },
      vendor: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { ref: "asc" }],
  });
}

/**
 * How far through the cutover the workspace is.
 *
 * The number that matters during a migration is not how many months imported
 * — it is how many have been checked and explained. An unresolved difference
 * is unfinished work whether or not anybody is looking at it.
 */
export async function progress(scope: Scope) {
  const db = tenantDb(scope.tenantId);
  const where = scope.allClients ? {} : { clientId: { in: [...scope.clientIds] } };

  const [total, resolved, clientMonths] = await Promise.all([
    db.reconciliation.count({ where }),
    db.reconciliation.count({ where: { ...where, resolvedAt: { not: null } } }),
    // Months that have entries but no expectation recorded against them —
    // imported and never checked, which is the state that quietly passes for
    // done.
    db.transaction.groupBy({
      by: ["clientId", "bookMonth"],
      where: { ...clientScope(scope), deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const recorded = await db.reconciliation.findMany({ where, select: { clientId: true, month: true } });
  const checked = new Set(recorded.map((r) => `${r.clientId}:${r.month}`));
  const unchecked = clientMonths.filter((row) => !checked.has(`${row.clientId}:${row.bookMonth}`));

  return {
    recorded: total,
    resolved,
    outstanding: total - resolved,
    /** Client-months with data that nobody has compared against anything. */
    unchecked: unchecked.length,
    uncheckedRows: unchecked.reduce((n, row) => n + row._count._all, 0),
  };
}

/**
 * Historical rows imported as Approved without anybody approving them.
 *
 * The PRD asks that these be flagged rather than indistinguishable from a real
 * approval, and this is the count that makes the flag mean something: if it
 * never appears anywhere, it is a column nobody looks at.
 */
export async function inferredApprovals(scope: Scope, month?: string) {
  const db = tenantDb(scope.tenantId);

  const [aggregate, byMonth] = await Promise.all([
    db.transaction.aggregate({
      where: { ...clientScope(scope), deletedAt: null, approvalInferred: true, ...(month ? { bookMonth: month } : {}) },
      _count: { _all: true },
      _sum: { amountBase: true },
    }),
    db.transaction.groupBy({
      by: ["bookMonth"],
      where: { ...clientScope(scope), deletedAt: null, approvalInferred: true },
      _count: { _all: true },
      orderBy: { bookMonth: "desc" },
      take: 24,
    }),
  ]);

  return {
    count: aggregate._count._all,
    value: aggregate._sum.amountBase ?? 0n,
    byMonth: byMonth.map((row) => ({ month: row.bookMonth, count: row._count._all })),
  };
}
