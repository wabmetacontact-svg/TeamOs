import type { Metadata } from "next";
import { requireManagerPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, monthLabel, monthRange, recentMonths } from "@/lib/dates";
import { breakdown, clientFinancials, monthTotals } from "@/lib/ledger";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { MonthPicker } from "@/components/app/month-picker";
import { BarList } from "@/components/app/bar-list";
import { ExportButton } from "@/components/app/export-button";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireManagerPage();
  const { m } = await searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const { start, end } = monthRange(month);
  const where = { date: { gte: start, lte: end } };

  const months = recentMonths(month, 6);
  const [totals, byCategory, bySource, byPayee, salaries, clients, trend] = await Promise.all([
    monthTotals(month),
    breakdown({ ...where, type: "EXPENSE" }, "categoryId"),
    breakdown({ ...where, type: "INCOME" }, "categoryId"),
    breakdown({ ...where, type: "EXPENSE" }, "name"),
    db.salary.findMany({ where: { month }, orderBy: { employeeName: "asc" } }),
    db.client.findMany({ orderBy: { name: "asc" } }),
    Promise.all(months.map(async (mm) => ({ month: mm, ...(await monthTotals(mm)) }))),
  ]);

  const clientRows = await Promise.all(clients.map(async (c) => ({ client: c, money: await clientFinancials(c.id) })));
  const salaryTotal = salaries.reduce((s, x) => s + x.amount, 0);
  const salaryPaid = salaries.reduce((s, x) => s + x.amountPaid, 0);
  const trendMax = Math.max(...trend.map((t) => Math.max(t.income, t.expense)), 1);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every number here is read from the same ledger."
        actions={
          <>
            <MonthPicker month={month} />
            <ExportButton type="transactions" month={month} label="Transactions" />
            <ExportButton type="salaries" month={month} label="Salaries" />
            <ExportButton type="tasks" label="Tasks" />
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Income" value={formatMoney(totals.income)} tone="green" sub={monthLabel(month)} />
        <Kpi label="Expenses" value={formatMoney(totals.expense)} tone="red" />
        <Kpi label="Net balance" value={formatMoney(totals.net)} tone={totals.net >= 0 ? "blue" : "red"} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Monthly trend" description="Last 6 months of income and expenses" />
        <CardBody>
          <div className="flex items-end gap-3 overflow-x-auto pb-1">
            {trend.map((t) => (
              <div key={t.month} className="flex min-w-14 flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t bg-[var(--green)]/80"
                    style={{ height: `${Math.max((t.income / trendMax) * 100, 2)}%` }}
                    title={`Income ${formatMoney(t.income)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-[var(--red)]/70"
                    style={{ height: `${Math.max((t.expense / trendMax) * 100, 2)}%` }}
                    title={`Expenses ${formatMoney(t.expense)}`}
                  />
                </div>
                <p className="text-[11px] text-muted">{monthLabel(t.month).split(" ")[0]?.slice(0, 3)}</p>
                <p className={cn("tabular text-[11px] font-medium", t.net >= 0 ? "text-[var(--green)]" : "text-[var(--red)]")}>
                  {formatMoneyShort(t.net)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 border-t border-border pt-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[var(--green)]/80" /> Income
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[var(--red)]/70" /> Expenses
            </span>
            <span className="ml-auto">Number below each month is the net balance</span>
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Expense by category" description={monthLabel(month)} />
          <CardBody>
            <BarList rows={byCategory} emptyLabel="No expenses this month" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Income by source" description={monthLabel(month)} />
          <CardBody>
            <BarList rows={bySource} emptyLabel="No income this month" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top payees" description="Who the money went to" />
          <CardBody>
            <BarList rows={byPayee.slice(0, 8)} emptyLabel="No expenses this month" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Salary report" description={`${monthLabel(month)} · ${salaries.length} people`} />
          <CardBody>
            {salaries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No salaries recorded for this month.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Total" value={formatMoney(salaryTotal)} />
                  <Stat label="Paid" value={formatMoney(salaryPaid)} className="text-[var(--green)]" />
                  <Stat label="Pending" value={formatMoney(salaryTotal - salaryPaid)} className="text-[var(--orange)]" />
                </div>
                <ul className="divide-y divide-border">
                  {salaries.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate">{s.employeeName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular font-medium">{formatMoney(s.amount)}</span>
                        <Badge tone={s.status === "Paid" ? "green" : s.status === "Partially Paid" ? "blue" : "orange"}>{s.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Client report" description="All time" />
        {clientRows.length === 0 ? (
          <CardBody>
            <p className="py-6 text-center text-sm text-muted">No clients yet.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contract</th>
                  <th className="px-3 py-2.5 text-right font-medium">Received</th>
                  <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2.5 font-medium">Last payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clientRows.map(({ client, money }) => {
                  const contract = client.contractValue ?? 0;
                  const outstanding = contract ? Math.max(contract - money.received, 0) : money.pending;
                  return (
                    <tr key={client.id} className="hover:bg-surface-2/60">
                      <td className="px-4 py-2.5 font-medium">{client.name}</td>
                      <td className="tabular px-3 py-2.5 text-right text-muted">{contract ? formatMoney(contract) : "—"}</td>
                      <td className="tabular px-3 py-2.5 text-right text-[var(--green)]">{formatMoney(money.received)}</td>
                      <td className={cn("tabular px-3 py-2.5 text-right", outstanding > 0 && "text-[var(--orange)]")}>
                        {formatMoney(outstanding)}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {money.lastPaymentDate ? new Date(money.lastPaymentDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("tabular mt-0.5 font-semibold", className)}>{value}</p>
    </div>
  );
}
