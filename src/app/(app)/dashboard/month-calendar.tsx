"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Lock, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CalendarDayData = {
  date: string;
  tasks: {
    id: string;
    name: string;
    status: string;
    priority: string;
    assigneeName: string;
    clientName: string | null;
    overdue: boolean;
  }[];
  /** Already formatted; null when nothing moved that way. */
  moneyIn: string | null;
  moneyOut: string | null;
  entries: number;
  recurring: { id: string; name: string; direction: string; amount: string; clientName: string }[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The month at a glance: tasks due, money that moved, recurring spends still
 * to post. Everything is fetched and scoped on the server; this only lays it
 * out and remembers which day is open.
 */
export function MonthCalendar({
  month,
  today,
  days,
  closedBooks,
  shows,
}: {
  month: string;
  today: string;
  days: CalendarDayData[];
  closedBooks: string[];
  shows: { tasks: boolean; money: boolean };
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // Monday first. getUTCDay() is 0 for Sunday.
  const lead = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;

  const dates = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);

  const initial = today.startsWith(month) ? today : (days[0]?.date ?? null);
  const [selected, setSelected] = useState<string | null>(initial);
  const open = selected ? byDate.get(selected) : undefined;

  const taskCount = days.reduce((n, d) => n + d.tasks.length, 0);
  const overdueCount = days.reduce((n, d) => n + d.tasks.filter((t) => t.overdue).length, 0);

  return (
    <Card className="mt-4">
      <CardHeader
        title="Calendar"
        description={
          [
            shows.tasks && `${taskCount} ${taskCount === 1 ? "task" : "tasks"} due${overdueCount ? `, ${overdueCount} overdue` : ""}`,
            shows.money && "approved money by the day it moved",
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing you can see is dated"
        }
        action={
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            {shows.tasks && <Legend className="bg-blue-500" label="Task" />}
            {shows.tasks && <Legend className="bg-[var(--red)]" label="Overdue" />}
            {shows.tasks && <Legend className="bg-emerald-500" label="Done" />}
            {shows.money && (
              <span className="flex items-center gap-1">
                <Repeat className="size-3" /> Recurring
              </span>
            )}
          </div>
        }
      />

      {closedBooks.length > 0 && (
        <p className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted">
          <Lock className="size-3.5 shrink-0" />
          Book closed for {closedBooks.slice(0, 4).join(", ")}
          {closedBooks.length > 4 && ` and ${closedBooks.length - 4} more`}
        </p>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="p-2 sm:p-3">
          <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-subtle">
            {WEEKDAYS.map((w) => (
              <div key={w}>
                <span className="sm:hidden">{w[0]}</span>
                <span className="hidden sm:inline">{w}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {cells.map((date, i) => {
              if (!date) return <div key={`blank-${i}`} className="min-h-14 bg-surface-2 sm:min-h-24" />;
              const data = byDate.get(date);
              const isToday = date === today;
              const isSelected = date === selected;
              const shown = data?.tasks.slice(0, 2) ?? [];
              const more = (data?.tasks.length ?? 0) - shown.length;

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelected(date)}
                  aria-pressed={isSelected}
                  aria-label={label(date, data)}
                  className={cn(
                    "flex min-h-14 flex-col items-stretch gap-0.5 bg-surface p-1 text-left transition-colors hover:bg-surface-hover sm:min-h-24 sm:p-1.5",
                    isSelected && "bg-surface-hover ring-2 ring-inset ring-brand",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full text-xs tabular-nums",
                        isToday ? "bg-brand font-semibold text-white" : "text-muted",
                      )}
                    >
                      {Number(date.slice(8))}
                    </span>
                    {data && data.recurring.length > 0 && <Repeat className="size-3 text-subtle" />}
                  </span>

                  {/* Phones get dots; anything wider gets names. */}
                  {data && data.tasks.length > 0 && (
                    <span className="flex flex-wrap gap-0.5 sm:hidden">
                      {data.tasks.slice(0, 4).map((t) => (
                        <span key={t.id} className={cn("size-1.5 rounded-full", dotClass(t))} />
                      ))}
                    </span>
                  )}

                  <span className="hidden flex-col gap-0.5 sm:flex">
                    {shown.map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "truncate rounded px-1 py-px text-[11px] leading-tight",
                          t.status === "Completed"
                            ? "bg-emerald-50 text-emerald-700 line-through decoration-emerald-400"
                            : t.overdue
                              ? "bg-rose-50 text-rose-700"
                              : "bg-blue-50 text-blue-700",
                        )}
                      >
                        {t.name}
                      </span>
                    ))}
                    {more > 0 && <span className="px-1 text-[11px] text-subtle">+{more} more</span>}
                  </span>

                  {data && (data.moneyIn || data.moneyOut) && (
                    <span className="mt-auto hidden truncate text-[10px] tabular-nums sm:block">
                      {data.moneyIn && <span className="text-emerald-600">+{data.moneyIn}</span>}
                      {data.moneyIn && data.moneyOut && " "}
                      {data.moneyOut && <span className="text-[var(--red)]">−{data.moneyOut}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <DayDetail date={selected} data={open} month={month} shows={shows} />
      </div>
    </Card>
  );
}

function DayDetail({
  date,
  data,
  month,
  shows,
}: {
  date: string | null;
  data: CalendarDayData | undefined;
  month: string;
  shows: { tasks: boolean; money: boolean };
}) {
  if (!date) {
    return (
      <aside className="flex items-center justify-center border-t border-border p-6 text-sm text-muted lg:border-l lg:border-t-0">
        Pick a day.
      </aside>
    );
  }

  const heading = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  const empty = !data || (data.tasks.length === 0 && data.entries === 0 && data.recurring.length === 0);

  return (
    <aside className="border-t border-border p-4 lg:border-l lg:border-t-0">
      <p className="text-sm font-semibold">{heading}</p>

      {empty ? (
        <p className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-muted">
          <CalendarDays className="size-5 text-subtle" />
          Nothing on this day.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 text-sm">
          {shows.tasks && data.tasks.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted">Due</p>
              <ul className="grid gap-1.5">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="group block rounded-md px-1.5 py-1 hover:bg-surface-hover">
                      <span className="flex items-start gap-2">
                        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotClass(t))} />
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate group-hover:underline",
                              t.status === "Completed" && "text-muted line-through",
                            )}
                          >
                            {t.name}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {t.assigneeName}
                            {t.clientName && ` · ${t.clientName}`}
                          </span>
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1 pl-4">
                        <Badge tone={t.status === "Completed" ? "green" : t.overdue ? "red" : "grey"}>
                          {t.overdue ? "Overdue" : t.status}
                        </Badge>
                        {(t.priority === "Urgent" || t.priority === "High") && (
                          <Badge tone="orange">{t.priority}</Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shows.money && data.entries > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted">Money</p>
              <Link
                href={`/ledger?month=${month}`}
                className="grid gap-1 rounded-md px-1.5 py-1 hover:bg-surface-hover"
              >
                {data.moneyIn && (
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-muted">
                      <ArrowDownLeft className="size-3.5" /> In
                    </span>
                    <span className="font-medium tabular-nums text-emerald-600">+{data.moneyIn}</span>
                  </span>
                )}
                {data.moneyOut && (
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-muted">
                      <ArrowUpRight className="size-3.5" /> Out
                    </span>
                    <span className="font-medium tabular-nums text-[var(--red)]">−{data.moneyOut}</span>
                  </span>
                )}
                <span className="text-xs text-subtle">
                  {data.entries} {data.entries === 1 ? "entry" : "entries"} dated this day
                  {!data.moneyIn && !data.moneyOut && ", none approved yet"}
                </span>
              </Link>
            </section>
          )}

          {shows.money && data.recurring.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted">Recurring, still to post</p>
              <ul className="grid gap-1">
                {data.recurring.map((r) => (
                  <li key={r.id}>
                    <Link
                      href="/ledger/recurring"
                      className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{r.name}</span>
                        <span className="block truncate text-xs text-muted">{r.clientName}</span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          r.direction === "IN" ? "text-emerald-600" : "text-[var(--red)]",
                        )}
                      >
                        {r.direction === "IN" ? "+" : "−"}
                        {r.amount}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}

function dotClass(task: { status: string; overdue: boolean }) {
  if (task.status === "Completed") return "bg-emerald-500";
  if (task.overdue) return "bg-[var(--red)]";
  return "bg-blue-500";
}

function label(date: string, data: CalendarDayData | undefined) {
  const parts = [date];
  if (data?.tasks.length) parts.push(`${data.tasks.length} ${data.tasks.length === 1 ? "task" : "tasks"}`);
  if (data?.entries) parts.push(`${data.entries} ledger ${data.entries === 1 ? "entry" : "entries"}`);
  if (data?.recurring.length) parts.push(`${data.recurring.length} recurring`);
  return parts.join(", ");
}
