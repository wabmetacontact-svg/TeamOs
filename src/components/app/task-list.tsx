"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Repeat, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { TASK_STATUS_TONE, type TaskStatus } from "@/lib/constants";
import { fmtDate } from "@/lib/dates";
import { recurrenceLabel, timingFor } from "@/lib/task-logic";
import { cn } from "@/lib/utils";
import { TaskFormDialog, type TaskFormOptions } from "./task-form";

export type TaskRow = {
  id: string;
  name: string;
  assigneeId: string;
  assigneeName: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  daysLate: number | null;
  verifiedByName: string | null;
  verifiedById: string | null;
  docUrl: string | null;
  notes: string | null;
  recurring: boolean;
  frequency: string | null;
  weekday: number | null;
  recurringStart: string | null;
  recurringEnd: string | null;
};

function timing(task: TaskRow) {
  return timingFor({
    status: task.status,
    dueDate: new Date(task.dueDate),
    completedAt: task.completedAt ? new Date(task.completedAt) : null,
    daysLate: task.daysLate,
  });
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TASK_STATUS_TONE[status as TaskStatus] ?? "grey"}>{status}</Badge>;
}

function TimingCell({ task }: { task: TaskRow }) {
  const t = timing(task);
  if (!t) return <span className="text-subtle">—</span>;
  return <Badge tone={t.tone === "green" ? "green" : "red"}>{t.label}</Badge>;
}

function toValues(task: TaskRow) {
  return {
    id: task.id,
    name: task.name,
    assigneeId: task.assigneeId,
    status: task.status,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    verifiedById: task.verifiedById,
    docUrl: task.docUrl,
    notes: task.notes,
    recurring: task.recurring,
    frequency: task.frequency,
    weekday: task.weekday,
    recurringStart: task.recurringStart,
    recurringEnd: task.recurringEnd,
  };
}

export function TaskList({ tasks, options }: { tasks: TaskRow[]; options: TaskFormOptions }) {
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("");
  const [timingFilter, setTimingFilter] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (q && !task.name.toLowerCase().includes(q) && !task.assigneeName.toLowerCase().includes(q)) return false;
      if (assignee && task.assigneeId !== assignee) return false;
      if (status && task.status !== status) return false;
      if (timingFilter) {
        const t = timing(task);
        if (timingFilter === "late" && !(task.status === "Completed" && (task.daysLate ?? 0) > 0)) return false;
        if (timingFilter === "overdue" && !(t?.tone === "red" && task.status !== "Completed")) return false;
        if (timingFilter === "today" && new Date(task.dueDate).toDateString() !== new Date().toDateString()) return false;
      }
      return true;
    });
  }, [tasks, query, assignee, status, timingFilter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search task or assignee"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm shadow-card outline-none placeholder:text-subtle focus:border-brand sm:w-60"
          />
        </div>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 w-auto min-w-36">
          <option value="">All assignees</option>
          {options.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-32">
          <option value="">All status</option>
          {Object.keys(TASK_STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={timingFilter} onChange={(e) => setTimingFilter(e.target.value)} className="h-9 w-auto min-w-32">
          <option value="">All timing</option>
          <option value="today">Due today</option>
          <option value="overdue">Overdue</option>
          <option value="late">Completed late</option>
        </Select>
        {(query || assignee || status || timingFilter) && (
          <button
            onClick={() => {
              setQuery("");
              setAssignee("");
              setStatus("");
              setTimingFilter("");
            }}
            className="text-[13px] text-muted hover:text-fg"
          >
            Clear
          </button>
        )}
        <span className="ml-auto hidden text-xs text-muted sm:block">
          {filtered.length} of {tasks.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No tasks match" description="Try a different search or clear the filters." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-3 py-2.5 font-medium">Assignee</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="px-3 py-2.5 font-medium">Completed</th>
                  <th className="px-3 py-2.5 font-medium">Timing</th>
                  <th className="px-3 py-2.5 font-medium">Verified</th>
                  <th className="px-3 py-2.5 font-medium">Doc</th>
                  <th className="px-4 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((task) => (
                  <tr key={task.id} className="hover:bg-surface-2/60">
                    <td className="max-w-[280px] px-4 py-2.5">
                      <p className="truncate font-medium">{task.name}</p>
                      {task.recurring && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand">
                          <Repeat className="size-3" />
                          {recurrenceLabel(task)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={task.assigneeName} className="size-6 text-[10px]" />
                        <span className="truncate">{task.assigneeName}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-muted">{fmtDate(task.dueDate, "dd/MM/yyyy")}</td>
                    <td className="tabular px-3 py-2.5 text-muted">{task.completedAt ? fmtDate(task.completedAt, "dd/MM/yyyy") : "—"}</td>
                    <td className="px-3 py-2.5">
                      <TimingCell task={task} />
                    </td>
                    <td className="px-3 py-2.5 text-muted">{task.verifiedByName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {task.docUrl ? (
                        <a
                          href={task.docUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          View <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <TaskFormDialog
                        options={options}
                        values={toValues(task)}
                        trigger={
                          <Button size="sm" variant="secondary">
                            Update
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <ul className="divide-y divide-border lg:hidden">
            {filtered.map((task) => (
              <li key={task.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{task.name}</p>
                  <StatusBadge status={task.status} />
                </div>
                {task.recurring && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-brand">
                    <Repeat className="size-3" />
                    {recurrenceLabel(task)}
                  </span>
                )}
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                  <Detail label="Assignee" value={task.assigneeName} />
                  <Detail label="Due" value={fmtDate(task.dueDate, "dd/MM/yyyy")} />
                  <Detail label="Completed" value={task.completedAt ? fmtDate(task.completedAt, "dd/MM/yyyy") : "—"} />
                  <Detail label="Verified" value={task.verifiedByName ?? "—"} />
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <TimingCell task={task} />
                  {task.docUrl && (
                    <a
                      href={task.docUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline"
                    >
                      View doc <ExternalLink className="size-3" />
                    </a>
                  )}
                  <TaskFormDialog
                    options={options}
                    values={toValues(task)}
                    trigger={
                      <Button size="sm" variant="secondary" className="ml-auto">
                        Update
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("truncate font-medium")}>{value}</dd>
    </div>
  );
}
