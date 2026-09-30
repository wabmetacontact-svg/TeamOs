import "server-only";
import type { PrismaClient } from "@prisma/client";
import { tenantTransaction } from "./db";
import { can, clientIdScope, clientScope, dashboardReach, type Scope } from "./scope";
import { bookMonthOf, previousBookMonth } from "./money";
import { dateOnly } from "./task-rules";

/**
 * The aggregate service.
 *
 * Every figure on a dashboard comes from here, and every function takes a
 * Scope. That is the whole design: two people looking at the same month are
 * *supposed* to see different totals, because they can reach different
 * clients — and the only way that is trustworthy is if the scope is an
 * argument nobody can forget rather than a filter somebody remembers.
 *
 * The queries are direct rather than going through a cache or a rollup table.
 * A rollup that can be stale is a number somebody quotes on a call and then
 * has to retract, and at this size the direct query is fast enough — which the
 * performance test asserts rather than assumes.
 *
 * Every result carries `asOf`. A dashboard without one is a screenshot people
 * treat as live.
 *
 * Each view takes an optional database client, which exists because of a
 * measurement rather than a guess.
 *
 * `tenantDb` binds each operation by wrapping it in a transaction, and the
 * obvious optimisation was to open one transaction for the whole page instead
 * of twenty. Measured, that made it **slower** — nearly twice as slow. Queries
 * inside an interactive transaction share a single connection and stop running
 * in parallel, and against a database one network away parallelism is worth
 * far more than the trips it saves. From this laptop to Singapore: twenty
 * trivial queries take 750 ms in parallel and 1,485 ms in sequence.
 *
 * So the views run in parallel, each binding for itself, and the parameter
 * stays for the callers that already hold a bound client and would otherwise
 * bind twice.
 */

/**
 * A client already bound to a tenant. One type rather than a union of the
 * extended client and the transaction client: Prisma's `groupBy` overloads do
 * not survive being unioned, and a view that cannot group is not a view.
 */
type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type Reach = ReturnType<typeof dashboardReach>;

export type DashboardContext = {
  scope: Scope;
  baseCurrency: string;
  timeZone: string;
  /** yyyy-MM. Defaults to the current month in the tenant's timezone. */
  month?: string;
};

function monthOf(ctx: DashboardContext): string {
  return ctx.month ?? bookMonthOf(new Date(`${dateOnly(new Date(), ctx.timeZone)}T12:00:00Z`));
}

// ───────────────────────────────────────────────────────────────── money ───

export type MoneyView = {
  month: string;
  previous: string;
  income: bigint;
  spend: bigint;
  net: bigint;
  previousSpend: bigint;
  previousIncome: bigint;
  entries: number;
  unapproved: number;
  /** Per client, largest spend first. */
  byClient: { clientId: string; name: string; income: bigint; spend: bigint }[];
  topCategories: { name: string; total: bigint }[];
};

/**
 * Money for a month, and the month before it for comparison.
 *
 * Approved entries only. A total that counts what nobody signed off is not a
 * total anybody can take to a client — and the unapproved count is returned
 * beside it so the gap is visible rather than silently missing.
 */
export async function moneyView(ctx: DashboardContext, client?: Db): Promise<MoneyView> {
  // Called on its own it opens its own transaction; called from
  // loadDashboard it shares the one already open.
  if (!client) return tenantTransaction(ctx.scope.tenantId, (tx) => moneyView(ctx, tx));
  const db = client;
  const month = monthOf(ctx);
  const previous = previousBookMonth(month);
  const scoped = clientScope(ctx.scope);

  const [current, prior, unapproved, categories, clients] = await Promise.all([
    db.transaction.groupBy({
      by: ["clientId", "direction"],
      where: { ...scoped, bookMonth: month, deletedAt: null, approvalState: "Approved" },
      _sum: { amountBase: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["direction"],
      where: { ...scoped, bookMonth: previous, deletedAt: null, approvalState: "Approved" },
      _sum: { amountBase: true },
    }),
    db.transaction.count({
      where: { ...scoped, bookMonth: month, deletedAt: null, approvalState: { in: ["Draft", "Submitted"] } },
    }),
    db.transaction.groupBy({
      by: ["categoryId"],
      where: { ...scoped, bookMonth: month, deletedAt: null, approvalState: "Approved", direction: "OUT" },
      _sum: { amountBase: true },
      orderBy: { _sum: { amountBase: "desc" } },
      take: 6,
    }),
    db.client.findMany({ where: { ...clientIdScope(ctx.scope), deletedAt: null }, select: { id: true, name: true } }),
  ]);

  const nameById = new Map(clients.map((c) => [c.id, c.name]));

  const byClientMap = new Map<string, { income: bigint; spend: bigint }>();
  let income = 0n;
  let spend = 0n;
  let entries = 0;

  for (const row of current) {
    const total = row._sum.amountBase ?? 0n;
    entries += row._count._all;

    const entry = byClientMap.get(row.clientId) ?? { income: 0n, spend: 0n };
    if (row.direction === "IN") {
      income += total;
      entry.income += total;
    } else {
      spend += total;
      entry.spend += total;
    }
    byClientMap.set(row.clientId, entry);
  }

  const categoryIds = categories.map((c) => c.categoryId).filter(Boolean) as string[];
  const categoryNames = categoryIds.length
    ? await db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : [];
  const categoryById = new Map(categoryNames.map((c) => [c.id, c.name]));

  return {
    month,
    previous,
    income,
    spend,
    net: income - spend,
    previousIncome: prior.find((r) => r.direction === "IN")?._sum.amountBase ?? 0n,
    previousSpend: prior.find((r) => r.direction === "OUT")?._sum.amountBase ?? 0n,
    entries,
    unapproved,
    byClient: [...byClientMap.entries()]
      .map(([clientId, totals]) => ({ clientId, name: nameById.get(clientId) ?? "Unknown", ...totals }))
      .sort((a, b) => (b.spend > a.spend ? 1 : b.spend < a.spend ? -1 : 0)),
    topCategories: categories.map((row) => ({
      name: row.categoryId ? (categoryById.get(row.categoryId) ?? "Unknown") : "Uncategorised",
      total: row._sum.amountBase ?? 0n,
    })),
  };
}

// ───────────────────────────────────────────────────────────────── tasks ───

export type TaskView = {
  open: number;
  overdue: number;
  dueToday: number;
  mine: number;
  completedThisMonth: number;
  lateThisMonth: number;
  /** Median days late among the ones that were late. Null when none were. */
  medianDaysLate: number | null;
  byAssignee: { userId: string; name: string; open: number; overdue: number }[];
};

export async function taskView(ctx: DashboardContext, client?: Db): Promise<TaskView> {
  // Called on its own it opens its own transaction; called from
  // loadDashboard it shares the one already open.
  if (!client) return tenantTransaction(ctx.scope.tenantId, (tx) => taskView(ctx, tx));
  const db = client;
  const reach = dashboardReach(ctx.scope);
  const today = dateOnly(new Date(), ctx.timeZone);
  const monthStart = `${monthOf(ctx)}-01`;

  // A Member sees their own work and nothing else. Anyone wider sees the
  // team's — which is the point of the distinction.
  const base = {
    deletedAt: null,
    ...(ctx.scope.allClients ? {} : { OR: [{ clientId: null }, { clientId: { in: [...ctx.scope.clientIds] } }] }),
    ...(reach === "own" ? { assigneeId: ctx.scope.userId } : {}),
    // Somebody else's private task is not in anybody's numbers.
    AND: [{ OR: [{ isPrivate: false }, { assigneeId: ctx.scope.userId }] }],
  };

  const [open, overdue, dueToday, mine, completed, byAssignee] = await Promise.all([
    db.task.count({ where: { ...base, status: { not: "Completed" } } }),
    db.task.count({
      where: { ...base, status: { not: "Completed" }, dueDate: { lt: new Date(`${today}T00:00:00.000Z`) } },
    }),
    db.task.count({
      where: {
        ...base,
        status: { not: "Completed" },
        dueDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: new Date(`${today}T23:59:59.999Z`) },
      },
    }),
    db.task.count({ where: { ...base, assigneeId: ctx.scope.userId, status: { not: "Completed" } } }),
    db.task.findMany({
      where: { ...base, status: "Completed", completedAt: { gte: new Date(`${monthStart}T00:00:00.000Z`) } },
      select: { daysLate: true },
    }),
    reach === "own"
      ? Promise.resolve([])
      : db.task.groupBy({
          by: ["assigneeId"],
          where: { ...base, status: { not: "Completed" } },
          _count: { _all: true },
        }),
  ]);

  const late = completed.map((t) => t.daysLate ?? 0).filter((n) => n > 0).sort((a, b) => a - b);

  // Median rather than mean: one task forgotten for four months drags an
  // average into meaninglessness, and the median still says what a typical
  // late task looks like.
  const medianDaysLate = late.length ? late[Math.floor(late.length / 2)]! : null;

  const people = byAssignee.length
    ? await db.user.findMany({
        where: { id: { in: byAssignee.map((r) => r.assigneeId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  const overdueByAssignee = byAssignee.length
    ? await db.task.groupBy({
        by: ["assigneeId"],
        where: { ...base, status: { not: "Completed" }, dueDate: { lt: new Date(`${today}T00:00:00.000Z`) } },
        _count: { _all: true },
      })
    : [];
  const overdueMap = new Map(overdueByAssignee.map((r) => [r.assigneeId, r._count._all]));

  return {
    open,
    overdue,
    dueToday,
    mine,
    completedThisMonth: completed.length,
    lateThisMonth: late.length,
    medianDaysLate,
    byAssignee: byAssignee
      .map((row) => ({
        userId: row.assigneeId,
        name: nameById.get(row.assigneeId) ?? "Unknown",
        open: row._count._all,
        overdue: overdueMap.get(row.assigneeId) ?? 0,
      }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open),
  };
}

// ────────────────────────────────────────────────────────────── calendar ───

export type CalendarTask = {
  id: string;
  name: string;
  status: string;
  priority: string;
  assigneeName: string;
  clientName: string | null;
  overdue: boolean;
};

export type CalendarRecurring = {
  id: string;
  name: string;
  direction: string;
  amount: bigint;
  currency: string;
  clientName: string;
};

export type CalendarDay = {
  /** yyyy-MM-dd */
  date: string;
  tasks: CalendarTask[];
  /** Approved money on the day it happened, in the base currency. */
  moneyIn: bigint;
  moneyOut: bigint;
  /** Every entry dated that day, whatever its approval state. */
  entries: number;
  /** Monthly rules that will post on this day and have not yet. */
  recurring: CalendarRecurring[];
};

export type CalendarView = {
  month: string;
  today: string;
  /** Only the days with something on them. */
  days: CalendarDay[];
  /** Clients whose book for this month is closed. */
  closedBooks: { clientId: string; name: string }[];
  /** What the viewer may see, so an empty calendar is not mistaken for a quiet month. */
  shows: { tasks: boolean; money: boolean };
};

/**
 * One month, day by day: the work due, the money that moved, the recurring
 * spends still to post, and which books are closed.
 *
 * Every part is bounded the way the rest of the dashboard is — tasks by the
 * same filter as taskView (reach, client scope, privacy), money by
 * clientScope — so a day never shows a total the cards above it would refuse
 * to add up. A part the viewer has no permission for is not fetched at all.
 */
export async function calendarView(ctx: DashboardContext, client?: Db): Promise<CalendarView> {
  if (!client) return tenantTransaction(ctx.scope.tenantId, (tx) => calendarView(ctx, tx));
  const db = client;
  const month = monthOf(ctx);
  const today = dateOnly(new Date(), ctx.timeZone);
  const reach = dashboardReach(ctx.scope);

  const showsTasks = can(ctx.scope, "task:view");
  const showsMoney = can(ctx.scope, "expense:view");

  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const first = `${month}-01`;
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const monthStart = new Date(`${first}T00:00:00.000Z`);
  const monthEnd = new Date(`${last}T23:59:59.999Z`);

  // A due date is stored at midday in the tenant's timezone, so a day either
  // side of the month in UTC catches every one of them; which day it belongs
  // to is decided below, in the tenant's timezone.
  const dueFrom = new Date(monthStart.getTime() - 86_400_000);
  const dueTo = new Date(monthEnd.getTime() + 86_400_000);

  const taskBase = {
    deletedAt: null,
    ...(ctx.scope.allClients ? {} : { OR: [{ clientId: null }, { clientId: { in: [...ctx.scope.clientIds] } }] }),
    ...(reach === "own" ? { assigneeId: ctx.scope.userId } : {}),
    AND: [{ OR: [{ isPrivate: false }, { assigneeId: ctx.scope.userId }] }],
  };
  const scoped = clientScope(ctx.scope);

  const [tasks, approved, counted, rules, closed] = await Promise.all([
    showsTasks
      ? db.task.findMany({
          where: { ...taskBase, dueDate: { gte: dueFrom, lte: dueTo } },
          select: {
            id: true,
            name: true,
            status: true,
            priority: true,
            dueDate: true,
            assignee: { select: { name: true } },
            client: { select: { name: true } },
          },
          orderBy: [{ dueDate: "asc" }, { name: "asc" }],
          take: 1000,
        })
      : Promise.resolve([]),
    // Ledger dates are calendar dates, stored at midnight UTC.
    showsMoney
      ? db.transaction.groupBy({
          by: ["date", "direction"],
          where: { ...scoped, deletedAt: null, approvalState: "Approved", date: { gte: monthStart, lte: monthEnd } },
          _sum: { amountBase: true },
        })
      : Promise.resolve([]),
    showsMoney
      ? db.transaction.groupBy({
          by: ["date"],
          where: { ...scoped, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    showsMoney
      ? db.recurringSpend.findMany({
          where: { ...scoped, active: true, nextRunAt: { lte: monthEnd } },
          select: {
            id: true,
            name: true,
            direction: true,
            amount: true,
            currency: true,
            dayOfMonth: true,
            nextRunAt: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    db.bookMonth.findMany({
      where: { ...scoped, month, state: "Closed" },
      select: { clientId: true, client: { select: { name: true } } },
    }),
  ]);

  const days = new Map<string, CalendarDay>();
  const day = (date: string) => {
    let entry = days.get(date);
    if (!entry) {
      entry = { date, tasks: [], moneyIn: 0n, moneyOut: 0n, entries: 0, recurring: [] };
      days.set(date, entry);
    }
    return entry;
  };

  for (const task of tasks) {
    const date = dateOnly(task.dueDate, ctx.timeZone);
    if (!date.startsWith(month)) continue;
    day(date).tasks.push({
      id: task.id,
      name: task.name,
      status: task.status,
      priority: task.priority,
      assigneeName: task.assignee.name,
      clientName: task.client?.name ?? null,
      overdue: task.status !== "Completed" && date < today,
    });
  }

  for (const row of approved) {
    const entry = day(row.date.toISOString().slice(0, 10));
    const total = row._sum.amountBase ?? 0n;
    if (row.direction === "IN") entry.moneyIn += total;
    else entry.moneyOut += total;
  }

  for (const row of counted) day(row.date.toISOString().slice(0, 10)).entries += row._count._all;

  // A monthly rule posts on its day. One whose next run is already past that
  // day has posted for this month, and its entry is counted above instead.
  for (const rule of rules) {
    const date = `${month}-${String(Math.min(rule.dayOfMonth, lastDay)).padStart(2, "0")}`;
    if (date < rule.nextRunAt.toISOString().slice(0, 10)) continue;
    day(date).recurring.push({
      id: rule.id,
      name: rule.name,
      direction: rule.direction,
      amount: rule.amount,
      currency: rule.currency,
      clientName: rule.client.name,
    });
  }

  return {
    month,
    today,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    closedBooks: closed.map((b) => ({ clientId: b.clientId, name: b.client.name })),
    shows: { tasks: showsTasks, money: showsMoney },
  };
}

// ─────────────────────────────────────────────────────────────── clients ───

export type ClientView = {
  active: number;
  total: number;
  byBrand: { brandId: string; name: string; count: number }[];
  withoutEntries: number;
};

export async function clientView(ctx: DashboardContext, client?: Db): Promise<ClientView> {
  // Called on its own it opens its own transaction; called from
  // loadDashboard it shares the one already open.
  if (!client) return tenantTransaction(ctx.scope.tenantId, (tx) => clientView(ctx, tx));
  const db = client;
  const scoped = clientIdScope(ctx.scope);
  const month = monthOf(ctx);

  const [clients, brands, withEntries] = await Promise.all([
    db.client.findMany({ where: { ...scoped, deletedAt: null }, select: { id: true, status: true, brandId: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
    db.transaction.findMany({
      where: { ...clientScope(ctx.scope), bookMonth: month, deletedAt: null },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
  ]);

  const nameById = new Map(brands.map((b) => [b.id, b.name]));
  const active = clients.filter((c) => c.status === "Active");
  const billed = new Set(withEntries.map((t) => t.clientId));

  const byBrand = new Map<string, number>();
  for (const client of active) byBrand.set(client.brandId, (byBrand.get(client.brandId) ?? 0) + 1);

  return {
    active: active.length,
    total: clients.length,
    byBrand: [...byBrand.entries()]
      .map(([brandId, count]) => ({ brandId, name: nameById.get(brandId) ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count),
    // An active client with nothing recorded this month is either a gap in the
    // books or a client who has quietly stopped.
    withoutEntries: active.filter((c) => !billed.has(c.id)).length,
  };
}

// ───────────────────────────────────────────────────────────── approvals ───

export type ApprovalView = { waiting: number; value: bigint; oldestSubmittedAt: Date | null };

export async function approvalView(ctx: DashboardContext, client?: Db): Promise<ApprovalView> {
  // Called on its own it opens its own transaction; called from
  // loadDashboard it shares the one already open.
  if (!client) return tenantTransaction(ctx.scope.tenantId, (tx) => approvalView(ctx, tx));
  const db = client;

  const [aggregate, oldest] = await Promise.all([
    db.transaction.aggregate({
      where: { ...clientScope(ctx.scope), deletedAt: null, approvalState: "Submitted" },
      _count: { _all: true },
      _sum: { amountBase: true },
    }),
    db.transaction.findFirst({
      where: { ...clientScope(ctx.scope), deletedAt: null, approvalState: "Submitted" },
      orderBy: { submittedAt: "asc" },
      select: { submittedAt: true },
    }),
  ]);

  return {
    waiting: aggregate._count._all,
    value: aggregate._sum.amountBase ?? 0n,
    oldestSubmittedAt: oldest?.submittedAt ?? null,
  };
}

// ───────────────────────────────────────────────────────── the whole page ───

export type Dashboard = {
  asOf: Date;
  reach: Reach;
  month: string;
  money: MoneyView;
  tasks: TaskView;
  calendar: CalendarView;
  clients: ClientView;
  approvals: ApprovalView;
};

/**
 * Everything the dashboard shows, in one round trip's worth of parallel
 * queries.
 *
 * Composed by reach rather than by role name, so a workspace that renames a
 * role or invents its own still gets the right thing — the permission is what
 * decides, and the permission is data.
 */
export async function loadDashboard(ctx: DashboardContext): Promise<Dashboard> {
  // In parallel, deliberately. See the note at the top of this file for the
  // measurement that settled it.
  const [money, tasks, calendar, clients, approvals] = await Promise.all([
    moneyView(ctx),
    taskView(ctx),
    calendarView(ctx),
    clientView(ctx),
    approvalView(ctx),
  ]);

  return {
    // Stamped after the queries, not before: it is when the numbers were true.
    asOf: new Date(),
    reach: dashboardReach(ctx.scope),
    month: monthOf(ctx),
    money,
    tasks,
    calendar,
    clients,
    approvals,
  };
}
