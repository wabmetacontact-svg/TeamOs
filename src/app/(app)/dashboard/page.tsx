import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManager, TASK_STATUS_TONE, type TaskStatus } from "@/lib/constants";
import { currentMonth, fmtDate, monthLabel, monthRange } from "@/lib/dates";
import { breakdown, monthTotals } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { getLedgerOptions, ledgerInclude, toLedgerRow } from "@/lib/queries";
import { computeDaysOverdue } from "@/lib/task-logic";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { MonthPicker } from "@/components/app/month-picker";
import { BarList } from "@/components/app/bar-list";
import { TransactionList } from "@/components/app/transaction-list";
import { AddExpenseButton, AddIncomeButton } from "@/components/app/transaction-form";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const { m, denied } = await searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const manager = isManager(user.role);

  const myTasks = await db.task.findMany({
    where: { assigneeId: user.id, status: { not: "Completed" } },
    include: { assignee: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take: 6,
  });

  return (
    <>
      {denied && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          That section is for managers only.
        </div>
      )}

      <PageHeader
        title={`Hi ${user.name.split(" ")[0]}`}
        description={manager ? "Your financial and team overview." : "Your work at a glance."}
        actions={manager && <MonthPicker month={month} />}
      />

      {manager ? <ManagerDashboard month={month} /> : null}

      <Card className={manager ? "mt-4 overflow-hidden" : "overflow-hidden"}>
        <CardHeader
          title="My open tasks"
          action={
            <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              All tasks <ArrowRight className="size-3" />
            </Link>
          }
        />
        {myTasks.length === 0 ? (
          <EmptyState icon={<CheckSquare />} title="Nothing open" description="You have no pending tasks right now." />
        ) : (
          <ul className="divide-y divide-border">
            {myTasks.map((task) => {
              const overdue = computeDaysOverdue(task.dueDate, task.status);
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{task.name}</span>
                    <span className="text-xs text-muted">Due {fmtDate(task.dueDate, "d MMM")}</span>
                  </span>
                  {overdue > 0 && (
                    <Badge tone="red">
                      <AlertTriangle className="size-3" /> {overdue} {overdue === 1 ? "day" : "days"} overdue
                    </Badge>
                  )}
                  <Badge tone={TASK_STATUS_TONE[task.status as TaskStatus] ?? "grey"}>{task.status}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

async function ManagerDashboard({ month }: { month: string }) {
  const { start, end } = monthRange(month);
  const where = { date: { gte: start, lte: end } };

  const [totals, expenseByCategory, recent, options, receivables, salaries] = await Promise.all([
    monthTotals(month),
    breakdown({ ...where, type: "EXPENSE" }, "categoryId"),
    db.transaction.findMany({ where, include: ledgerInclude, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6 }),
    getLedgerOptions(),
    db.transaction.aggregate({ where: { type: "INCOME", status: "Pending" }, _sum: { amount: true }, _count: true }),
    db.salary.findMany({ where: { month } }),
  ]);

  const salaryTotal = salaries.reduce((s, x) => s + x.amount, 0);
  const salaryPending = salaries.filter((s) => s.status !== "Paid").reduce((s, x) => s + (x.amount - x.amountPaid), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Income received" value={formatMoney(totals.income)} tone="green" sub={monthLabel(month)} />
        <Kpi label="Total expenses" value={formatMoney(totals.expense)} tone="red" sub={`${totals.count} entries`} />
        <Kpi
          label="Net balance"
          value={formatMoney(totals.net)}
          tone={totals.net >= 0 ? "blue" : "red"}
          sub={totals.net >= 0 ? "In profit this month" : "Spending more than earning"}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi
          label="Client receivables"
          value={formatMoney(receivables._sum.amount ?? 0)}
          tone={receivables._count ? "orange" : "neutral"}
          sub={`${receivables._count} pending payment${receivables._count === 1 ? "" : "s"}`}
        />
        <Kpi label="Salary paid" value={formatMoney(totals.salaryPaid)} sub={salaryTotal ? `of ${formatMoney(salaryTotal)} planned` : "No salaries set"} />
        <Kpi label="Salary pending" value={formatMoney(salaryPending)} tone={salaryPending ? "orange" : "neutral"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Recent transactions"
            action={
              <div className="flex gap-2">
                <AddIncomeButton options={options} />
                <AddExpenseButton options={options} />
              </div>
            }
          />
          <TransactionList rows={recent.map(toLedgerRow)} options={options} showFilters={false} compact />
        </Card>

        <Card>
          <CardHeader
            title="Expense breakdown"
            description={monthLabel(month)}
            action={
              <Link href="/reports" className="text-xs font-medium text-brand hover:underline">
                Reports
              </Link>
            }
          />
          <CardBody>
            <BarList rows={expenseByCategory.slice(0, 7)} emptyLabel="No expenses this month" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
