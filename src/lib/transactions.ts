import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { clientScope, NotFoundError, type Scope } from "./scope";

/**
 * The ledger.
 *
 * One table for money in and money out, separated by `direction`. The three
 * tools this replaces kept income in a different place from spend, which is
 * why nobody could answer "what did this client actually cost us" without
 * opening two sheets and trusting that both were current.
 *
 * Every read here descends from `transactionWhere`, which spreads nothing and
 * nests the scope filter inside AND — the same shape as clients and contexts,
 * for the same reason each of those had a bug before it was written that way.
 */

// Re-exported so server code that already imports from here keeps working.
// They are defined in ledger-enums.ts because the client needs them too, and
// this module is server-only — see the comment there.
export { APPROVAL_STATES, DIRECTIONS, PAYMENT_METHODS, PAYMENT_STATUSES } from "./ledger-enums";

function transactionWhere(scope: Scope, extra?: Prisma.TransactionWhereInput): Prisma.TransactionWhereInput {
  return { AND: [clientScope(scope), { deletedAt: null }, extra ?? {}] };
}

export type TransactionFilters = {
  bookMonth?: string;
  /** An inclusive range, when one month is not the unit being looked at. */
  fromMonth?: string;
  toMonth?: string;
  clientId?: string;
  categoryId?: string;
  vendorId?: string;
  direction?: string;
  approvalState?: string;
  paymentStatus?: string;
  createdById?: string;
  q?: string;
  /** Rows this person entered, for the "mine" view a Member gets. */
  mineOnly?: boolean;
};

function filterWhere(scope: Scope, filters: TransactionFilters): Prisma.TransactionWhereInput {
  const extra: Prisma.TransactionWhereInput = {};

  if (filters.bookMonth) extra.bookMonth = filters.bookMonth;
  else if (filters.fromMonth || filters.toMonth) {
    extra.bookMonth = {
      ...(filters.fromMonth ? { gte: filters.fromMonth } : {}),
      ...(filters.toMonth ? { lte: filters.toMonth } : {}),
    };
  }

  if (filters.clientId) extra.clientId = filters.clientId;
  if (filters.categoryId) extra.categoryId = filters.categoryId;
  if (filters.vendorId) extra.vendorId = filters.vendorId;
  if (filters.direction) extra.direction = filters.direction;
  if (filters.approvalState) extra.approvalState = filters.approvalState;
  if (filters.paymentStatus) extra.paymentStatus = filters.paymentStatus;
  if (filters.mineOnly) extra.createdById = scope.userId;
  else if (filters.createdById) extra.createdById = filters.createdById;

  const q = filters.q?.trim();
  if (q) {
    extra.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { ref: { contains: q, mode: "insensitive" } },
      { tags: { has: q } },
    ];
  }

  return transactionWhere(scope, extra);
}

const listInclude = {
  client: { select: { id: true, name: true, billingCurrency: true, brand: { select: { name: true } } } },
  category: { select: { id: true, name: true, color: true, parent: { select: { name: true } } } },
  vendor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.TransactionInclude;

export async function listTransactions(scope: Scope, filters: TransactionFilters = {}, take = 200) {
  return tenantDb(scope.tenantId).transaction.findMany({
    where: filterWhere(scope, filters),
    include: listInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
}

export async function getTransaction(scope: Scope, id: string) {
  const transaction = await tenantDb(scope.tenantId).transaction.findFirst({
    where: transactionWhere(scope, { id }),
    include: {
      ...listInclude,
      attachments: {
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!transaction) throw new NotFoundError();
  return transaction;
}

/**
 * The number the gate reconciles against: per client, per month, per direction.
 *
 * Built from `amountBase` only. Nothing here converts anything — the conversion
 * happened once, at entry, at the rate that applied then. That is what makes a
 * rate change today unable to move last month's figures.
 *
 * Drafts and rejections are excluded by default: a total that counts money
 * nobody approved is not a total anybody can take to a client.
 */
export async function monthTotals(
  scope: Scope,
  filters: TransactionFilters & { includeUnapproved?: boolean } = {},
) {
  const where = filterWhere(scope, {
    ...filters,
    approvalState: filters.includeUnapproved ? filters.approvalState : "Approved",
  });

  const grouped = await tenantDb(scope.tenantId).transaction.groupBy({
    by: ["clientId", "bookMonth", "direction"],
    where,
    _sum: { amountBase: true },
    _count: { _all: true },
  });

  const rows = grouped.map((row) => ({
    clientId: row.clientId,
    bookMonth: row.bookMonth,
    direction: row.direction,
    total: row._sum.amountBase ?? 0n,
    count: row._count._all,
  }));

  const income = rows.filter((r) => r.direction === "IN").reduce((a, r) => a + r.total, 0n);
  const spend = rows.filter((r) => r.direction === "OUT").reduce((a, r) => a + r.total, 0n);

  return { rows, income, spend, net: income - spend };
}

/** The same shape, grouped by category, for the breakdown on a month page. */
export async function categoryTotals(scope: Scope, filters: TransactionFilters = {}) {
  const db = tenantDb(scope.tenantId);

  const grouped = await db.transaction.groupBy({
    by: ["categoryId"],
    where: filterWhere(scope, { ...filters, approvalState: filters.approvalState ?? "Approved" }),
    _sum: { amountBase: true },
    _count: { _all: true },
  });

  const categories = await db.category.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId).filter(Boolean) as string[] } },
    select: { id: true, name: true, color: true, direction: true, parent: { select: { id: true, name: true } } },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  return grouped
    .map((row) => ({
      category: row.categoryId ? (byId.get(row.categoryId) ?? null) : null,
      total: row._sum.amountBase ?? 0n,
      count: row._count._all,
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

/** What is waiting on somebody, for the approvals queue. */
export async function pendingApprovals(scope: Scope) {
  return tenantDb(scope.tenantId).transaction.findMany({
    where: transactionWhere(scope, { approvalState: "Submitted" }),
    include: listInclude,
    orderBy: { submittedAt: "asc" },
  });
}

/**
 * The state of a client's months: which are closed, which are open, and what is
 * still unapproved inside each. Closing a month with submissions still pending
 * is the mistake this is here to make visible.
 */
export async function bookMonthState(scope: Scope, clientId: string, months: string[]) {
  const db = tenantDb(scope.tenantId);

  const [rows, pending] = await Promise.all([
    db.bookMonth.findMany({
      where: { clientId, month: { in: months } },
      include: { closedBy: { select: { name: true } } },
    }),
    db.transaction.groupBy({
      by: ["bookMonth"],
      where: transactionWhere(scope, { clientId, bookMonth: { in: months }, approvalState: { in: ["Draft", "Submitted"] } }),
      _count: { _all: true },
    }),
  ]);

  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const pendingByMonth = new Map(pending.map((p) => [p.bookMonth, p._count._all]));

  return months.map((month) => ({
    month,
    state: byMonth.get(month)?.state ?? "Open",
    closedAt: byMonth.get(month)?.closedAt ?? null,
    closedBy: byMonth.get(month)?.closedBy?.name ?? null,
    reopenReason: byMonth.get(month)?.reopenReason ?? null,
    unapproved: pendingByMonth.get(month) ?? 0,
  }));
}

/** Whether one client-month is closed. The application's half of the guard. */
export async function isMonthClosed(scope: Scope, clientId: string, bookMonth: string): Promise<boolean> {
  const row = await tenantDb(scope.tenantId).bookMonth.findFirst({
    where: { clientId, month: bookMonth, state: "Closed" },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * The next reference for a tenant, as TX-YYYYMMDD-NNN.
 *
 * Taken from the highest existing ref for that day rather than a counter table,
 * because a counter is a second thing to keep in step. The unique index on
 * (tenantId, ref) is what actually guarantees it; a collision under
 * concurrency retries.
 */
export async function nextRef(scope: Scope, date: Date): Promise<string> {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `TX-${stamp}-`;

  const last = await tenantDb(scope.tenantId).transaction.findFirst({
    where: { ref: { startsWith: prefix } },
    orderBy: { ref: "desc" },
    select: { ref: true },
  });

  const n = last ? Number(last.ref.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

/** The two-level category tree, parents with their children. */
export async function categoryTree(scope: Scope, direction?: string) {
  const categories = await tenantDb(scope.tenantId).category.findMany({
    where: { archived: false, ...(direction ? { direction } : {}) },
    include: { children: { where: { archived: false }, orderBy: { name: "asc" } }, _count: { select: { transactions: true } } },
    orderBy: { name: "asc" },
  });

  // Only roots at the top level; children hang off them. Two levels is the
  // limit the PRD sets, and the query relies on it — a third would need
  // recursion, and nobody has ever wanted one.
  return categories.filter((c) => !c.parentId);
}
