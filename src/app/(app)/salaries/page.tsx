import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { requireManagerPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { SALARY_STATUS_TONE, type SalaryStatus } from "@/lib/constants";
import { currentMonth, fmtDate, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { MonthPicker } from "@/components/app/month-picker";
import { AddSalaryButton, SalaryRowActions } from "@/components/app/salary-form";
import { ExportButton } from "@/components/app/export-button";

export const metadata: Metadata = { title: "Salaries" };

export default async function SalariesPage({ searchParams }: PageProps<"/salaries">) {
  await requireManagerPage();
  const { m } = await searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();

  const [salaries, team, priorNames] = await Promise.all([
    db.salary.findMany({ where: { month }, orderBy: { employeeName: "asc" } }),
    db.user.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
    db.salary.findMany({ distinct: ["employeeName"], select: { employeeName: true }, take: 100 }),
  ]);

  const people = [...new Set([...team.map((t) => t.name), ...priorNames.map((p) => p.employeeName)])].sort();
  const total = salaries.reduce((s, x) => s + x.amount, 0);
  const paid = salaries.reduce((s, x) => s + x.amountPaid, 0);
  const pending = total - paid;

  return (
    <>
      <PageHeader
        title="Salaries"
        description="Mark a salary paid and the expense is recorded for you."
        actions={
          <>
            <MonthPicker month={month} />
            <ExportButton type="salaries" month={month} />
            <AddSalaryButton month={month} people={people} />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label="Total salaries" value={formatMoney(total)} sub={monthLabel(month)} />
        <Kpi label="Paid" value={formatMoney(paid)} tone="green" />
        <Kpi label="Pending" value={formatMoney(pending)} tone={pending ? "orange" : "neutral"} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${monthLabel(month)} payroll`} description={`${salaries.length} people`} />
        {salaries.length === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title="No salaries for this month"
            description="Add the team's salaries once and update their status each month."
            action={<AddSalaryButton month={month} people={people} />}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    <th className="px-3 py-2.5 text-right font-medium">Salary</th>
                    <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-3 py-2.5 font-medium">Payment date</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {salaries.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-2/60">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{s.employeeName}</p>
                        {s.notes && <p className="truncate text-xs text-muted">{s.notes}</p>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatMoney(s.amount)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-muted">{s.amountPaid ? formatMoney(s.amountPaid) : "—"}</td>
                      <td className="tabular px-3 py-2.5 text-muted">{s.paymentDate ? fmtDate(s.paymentDate, "d MMM yyyy") : "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={SALARY_STATUS_TONE[s.status as SalaryStatus] ?? "grey"}>{s.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <SalaryRowActions salary={s} month={month} people={people} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border sm:hidden">
              {salaries.map((s) => (
                <li key={s.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{s.employeeName}</p>
                      <p className="text-xs text-muted">
                        {s.paymentDate ? fmtDate(s.paymentDate, "d MMM") : "Not paid yet"}
                        {s.amountPaid > 0 && s.amountPaid < s.amount ? ` · ${formatMoney(s.amountPaid)} paid` : ""}
                      </p>
                    </div>
                    <span className="tabular shrink-0 font-semibold">{formatMoney(s.amount)}</span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <Badge tone={SALARY_STATUS_TONE[s.status as SalaryStatus] ?? "grey"}>{s.status}</Badge>
                    <SalaryRowActions salary={s} month={month} people={people} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
