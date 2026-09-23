import type { Metadata } from "next";
import Link from "next/link";
import { eachDayOfInterval, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfWeek } from "date-fns";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManager } from "@/lib/constants";
import { currentMonth, fmtDate, monthRange } from "@/lib/dates";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { MonthPicker } from "@/components/app/month-picker";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requireUser();
  const { m, d } = await searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const { start, end } = monthRange(month);
  const manager = isManager(user.role);

  const [transactions, tasks] = await Promise.all([
    manager
      ? db.transaction.findMany({
          where: { date: { gte: start, lte: end } },
          include: { category: { select: { name: true } } },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
    db.task.findMany({
      where: { dueDate: { gte: start, lte: end }, ...(manager ? {} : { assigneeId: user.id }) },
      include: { assignee: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const gridStart = startOfWeek(start, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(end, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const selected = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : null;
  const dayTx = (day: Date) => transactions.filter((t) => isSameDay(t.date, day));
  const dayTasks = (day: Date) => tasks.filter((t) => isSameDay(t.dueDate, day));

  const selectedTx = selected ? dayTx(selected) : [];
  const selectedTasks = selected ? dayTasks(selected) : [];
  const selIncome = selectedTx.filter((t) => t.type === "INCOME" && t.status !== "Pending").reduce((s, t) => s + t.amount, 0);
  const selExpense = selectedTx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);

  const href = (day: Date | null) => {
    const q = new URLSearchParams({ m: month });
    if (day) q.set("d", format(day, "yyyy-MM-dd"));
    return `/calendar?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        description={manager ? "Money movement and task deadlines, day by day." : "Your task deadlines."}
        actions={<MonthPicker month={month} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-xs font-medium text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <div key={label} className="px-2 py-2 text-center">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const tx = dayTx(day);
              const dTasks = dayTasks(day);
              const income = tx.filter((t) => t.type === "INCOME" && t.status !== "Pending").reduce((s, t) => s + t.amount, 0);
              const expense = tx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
              const inMonth = isSameMonth(day, start);
              const isSelected = selected && isSameDay(day, selected);

              return (
                <Link
                  key={day.toISOString()}
                  href={href(day)}
                  scroll={false}
                  className={cn(
                    "min-h-20 border-b border-r border-border p-1.5 transition-colors last:border-r-0 hover:bg-surface-hover sm:min-h-24 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-surface-2/60",
                    isSelected && "bg-brand-soft ring-1 ring-inset ring-brand/30",
                  )}
                >
                  <span
                    className={cn(
                      "tabular flex size-6 items-center justify-center rounded-full text-xs",
                      isToday(day) ? "bg-brand font-semibold text-white" : inMonth ? "text-fg" : "text-subtle",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {income > 0 && <p className="tabular truncate text-[11px] font-medium text-[var(--green)]">+{formatMoneyShort(income)}</p>}
                    {expense > 0 && <p className="tabular truncate text-[11px] font-medium text-[var(--red)]">−{formatMoneyShort(expense)}</p>}
                    {dTasks.length > 0 && (
                      <p className="truncate text-[11px] text-muted">
                        {dTasks.length} task{dTasks.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader
            title={selected ? fmtDate(selected, "d MMMM yyyy") : "Pick a day"}
            description={selected ? undefined : "Click any date to see what happened."}
            action={selected && <Link href={href(null)} className="text-xs text-muted hover:text-fg">Clear</Link>}
          />
          <CardBody className="space-y-4">
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted">Nothing selected.</p>
            ) : (
              <>
                {manager && (
                  <>
                    <Section title="Income">
                      {selectedTx.filter((t) => t.type === "INCOME").length === 0 ? (
                        <p className="text-sm text-muted">No income.</p>
                      ) : (
                        selectedTx
                          .filter((t) => t.type === "INCOME")
                          .map((t) => (
                            <Line key={t.id} label={t.name} sub={t.category?.name} amount={`+${formatMoney(t.amount)}`} tone="green" />
                          ))
                      )}
                    </Section>

                    <Section title="Expenses">
                      {selectedTx.filter((t) => t.type === "EXPENSE").length === 0 ? (
                        <p className="text-sm text-muted">No expenses.</p>
                      ) : (
                        selectedTx
                          .filter((t) => t.type === "EXPENSE")
                          .map((t) => (
                            <Line key={t.id} label={t.name} sub={t.category?.name} amount={`−${formatMoney(t.amount)}`} tone="red" />
                          ))
                      )}
                    </Section>

                    <div className="flex items-center justify-between border-t border-border pt-3">
                      <span className="text-sm font-medium">Net movement</span>
                      <span className={cn("tabular font-semibold", selIncome - selExpense >= 0 ? "text-[var(--green)]" : "text-[var(--red)]")}>
                        {formatMoney(selIncome - selExpense)}
                      </span>
                    </div>
                  </>
                )}

                <Section title="Tasks due">
                  {selectedTasks.length === 0 ? (
                    <p className="text-sm text-muted">No tasks due.</p>
                  ) : (
                    selectedTasks.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{t.name}</span>
                        <Badge tone={t.status === "Completed" ? "green" : t.status === "Blocked" ? "red" : "grey"}>{t.assignee.name}</Badge>
                      </div>
                    ))
                  )}
                </Section>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Line({ label, sub, amount, tone }: { label: string; sub?: string; amount: string; tone: "green" | "red" }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <span className={cn("tabular shrink-0 font-medium", tone === "green" ? "text-[var(--green)]" : "text-fg")}>{amount}</span>
    </div>
  );
}
