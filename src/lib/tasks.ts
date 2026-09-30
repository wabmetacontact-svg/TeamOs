import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { NotFoundError, type Scope } from "./scope";
import { dateOnly } from "./task-rules";

/**
 * Reading tasks.
 *
 * Two things make the `where` here different from clients or transactions.
 *
 * A task need not belong to a client. Internal work — "redo the deck template"
 * — has no client, and a Manager scoped to two clients should still see it.
 * So the client filter is "no client, or one of mine", not "one of mine".
 *
 * And a private task is visible only to the person it is on and the person who
 * put it there. That is a second filter, ANDed with the first, so neither can
 * widen the other.
 */

function taskWhere(scope: Scope, extra?: Prisma.TaskWhereInput): Prisma.TaskWhereInput {
  const clientFilter: Prisma.TaskWhereInput = scope.allClients
    ? {}
    : { OR: [{ clientId: null }, { clientId: { in: [...scope.clientIds] } }] };

  const privacyFilter: Prisma.TaskWhereInput = {
    OR: [{ isPrivate: false }, { assigneeId: scope.userId }, { assignedById: scope.userId }],
  };

  return { AND: [clientFilter, privacyFilter, { deletedAt: null }, extra ?? {}] };
}

export type TaskFilters = {
  status?: string;
  /** Everything that is not Completed. The default working view. */
  openOnly?: boolean;
  assigneeId?: string;
  mineOnly?: boolean;
  clientId?: string;
  brandId?: string;
  priority?: string;
  q?: string;
  /** yyyy-MM-dd, inclusive. */
  dueFrom?: string;
  dueTo?: string;
  overdueOnly?: boolean;
};

function filterWhere(scope: Scope, filters: TaskFilters, timeZone: string): Prisma.TaskWhereInput {
  const extra: Prisma.TaskWhereInput = {};

  if (filters.status) extra.status = filters.status;
  else if (filters.openOnly) extra.status = { not: "Completed" };

  if (filters.mineOnly) extra.assigneeId = scope.userId;
  else if (filters.assigneeId) extra.assigneeId = filters.assigneeId;

  if (filters.clientId) extra.clientId = filters.clientId;
  if (filters.brandId) extra.brandId = filters.brandId;
  if (filters.priority) extra.priority = filters.priority;

  if (filters.dueFrom || filters.dueTo) {
    extra.dueDate = {
      ...(filters.dueFrom ? { gte: new Date(`${filters.dueFrom}T00:00:00.000Z`) } : {}),
      ...(filters.dueTo ? { lte: new Date(`${filters.dueTo}T23:59:59.999Z`) } : {}),
    };
  }

  if (filters.overdueOnly) {
    // Compared as a date in the tenant's timezone, then turned back into an
    // instant — a task due today is not overdue, however late in the day it is.
    const today = dateOnly(new Date(), timeZone);
    extra.dueDate = { lt: new Date(`${today}T00:00:00.000Z`) };
    extra.status = { not: "Completed" };
  }

  const q = filters.q?.trim();
  if (q) {
    extra.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
    ];
  }

  return taskWhere(scope, extra);
}

const listInclude = {
  assignee: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  relationship: { select: { id: true, person: { select: { name: true } }, context: { select: { name: true } } } },
  verifiedBy: { select: { id: true, name: true } },
  _count: { select: { statusHistory: true } },
} satisfies Prisma.TaskInclude;

export async function listTasks(scope: Scope, filters: TaskFilters, timeZone: string, take = 300) {
  return tenantDb(scope.tenantId).task.findMany({
    where: filterWhere(scope, filters, timeZone),
    include: listInclude,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { priority: "asc" }],
    take,
  });
}

export async function getTask(scope: Scope, id: string) {
  const task = await tenantDb(scope.tenantId).task.findFirst({
    where: taskWhere(scope, { id }),
    include: {
      ...listInclude,
      statusHistory: {
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) throw new NotFoundError();
  return task;
}

/**
 * What is on one person today: overdue first, then due today, then the rest of
 * the week. The view the PRD calls "my day".
 *
 * Overdue first is not a sort preference. A list that puts today's work above
 * last week's unfinished work is a list that lets things quietly rot.
 */
export async function myDay(scope: Scope, timeZone: string) {
  const db = tenantDb(scope.tenantId);
  const today = dateOnly(new Date(), timeZone);
  const weekEnd = new Date(`${today}T00:00:00.000Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const [overdue, dueToday, upcoming, waiting] = await Promise.all([
    db.task.findMany({
      where: taskWhere(scope, {
        assigneeId: scope.userId,
        status: { not: "Completed" },
        dueDate: { lt: new Date(`${today}T00:00:00.000Z`) },
      }),
      include: listInclude,
      orderBy: { dueDate: "asc" },
    }),
    db.task.findMany({
      where: taskWhere(scope, {
        assigneeId: scope.userId,
        status: { not: "Completed" },
        dueDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: new Date(`${today}T23:59:59.999Z`) },
      }),
      include: listInclude,
      orderBy: { priority: "asc" },
    }),
    db.task.findMany({
      where: taskWhere(scope, {
        assigneeId: scope.userId,
        status: { not: "Completed" },
        dueDate: { gt: new Date(`${today}T23:59:59.999Z`), lte: weekEnd },
      }),
      include: listInclude,
      orderBy: { dueDate: "asc" },
    }),
    // Things this person put on somebody else that are now back with them.
    db.task.findMany({
      where: taskWhere(scope, { assignedById: scope.userId, assigneeId: { not: scope.userId }, status: "In Review" }),
      include: listInclude,
      orderBy: { dueDate: "asc" },
    }),
  ]);

  return { today, overdue, dueToday, upcoming, waiting };
}

/** Counts for the header, computed once rather than by loading every row. */
export async function taskCounts(scope: Scope, timeZone: string) {
  const db = tenantDb(scope.tenantId);
  const today = dateOnly(new Date(), timeZone);

  const [byStatus, overdue, mine] = await Promise.all([
    db.task.groupBy({
      by: ["status"],
      where: taskWhere(scope),
      _count: { _all: true },
    }),
    db.task.count({
      where: taskWhere(scope, { status: { not: "Completed" }, dueDate: { lt: new Date(`${today}T00:00:00.000Z`) } }),
    }),
    db.task.count({ where: taskWhere(scope, { assigneeId: scope.userId, status: { not: "Completed" } }) }),
  ]);

  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  const open = byStatus.filter((r) => r.status !== "Completed").reduce((n, r) => n + r._count._all, 0);

  return { counts, open, overdue, mine };
}

/** Recurring series, for the page that explains what will appear tomorrow. */
export async function recurringTasks(scope: Scope) {
  return tenantDb(scope.tenantId).task.findMany({
    where: taskWhere(scope, { recurring: true, nextCreated: false, status: { not: "Completed" } }),
    include: listInclude,
    orderBy: { dueDate: "asc" },
  });
}
