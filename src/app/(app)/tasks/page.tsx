import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManager } from "@/lib/constants";
import { computeDaysOverdue, performanceFor } from "@/lib/task-logic";
import { toDateInput } from "@/lib/dates";
import { cn, pct } from "@/lib/utils";
import { Card, CardHeader, EmptyState, PageHeader, Progress } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { TaskList, type TaskRow } from "@/components/app/task-list";
import { NewTaskButton, type TaskFormOptions } from "@/components/app/task-form";
import { ExportButton } from "@/components/app/export-button";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();
  const { tab } = await searchParams;
  const manager = isManager(user.role);
  const view = tab === "performance" && manager ? "performance" : "tasks";

  const [tasks, people] = await Promise.all([
    db.task.findMany({
      where: manager ? {} : { assigneeId: user.id },
      include: { assignee: { select: { id: true, name: true } }, verifiedBy: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);

  const options: TaskFormOptions = {
    assignees: people.map((p) => ({ id: p.id, name: p.name })),
    verifiers: people.filter((p) => isManager(p.role)).map((p) => ({ id: p.id, name: p.name })),
    canManage: manager,
    today: toDateInput(new Date()),
  };

  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee.name,
    status: t.status,
    dueDate: t.dueDate.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    daysLate: t.daysLate,
    verifiedById: t.verifiedById,
    verifiedByName: t.verifiedBy?.name ?? null,
    docUrl: t.docUrl,
    notes: t.notes,
    recurring: t.recurring,
    frequency: t.frequency,
    weekday: t.weekday,
    recurringStart: t.recurringStart?.toISOString() ?? null,
    recurringEnd: t.recurringEnd?.toISOString() ?? null,
  }));

  const stats = {
    total: tasks.length,
    notStarted: tasks.filter((t) => t.status === "Not Started").length,
    inReview: tasks.filter((t) => t.status === "In Review").length,
    completed: tasks.filter((t) => t.status === "Completed").length,
    overdue: tasks.filter((t) => computeDaysOverdue(t.dueDate, t.status) > 0).length,
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description={manager ? "Everything the team is working on." : "Your tasks."}
        actions={
          <>
            <ExportButton type="tasks" />
            {manager && <NewTaskButton options={options} />}
          </>
        }
      />

      {manager && (
        <div className="mb-5 flex gap-1 border-b border-border">
          {[
            { id: "tasks", label: "Tasks", href: "/tasks" },
            { id: "performance", label: "Team Performance", href: "/tasks?tab=performance" },
          ].map((t) => (
            <Link
              key={t.id}
              href={t.href}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition",
                view === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}

      {view === "tasks" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Total tasks" value={stats.total} />
            <Kpi label="Not started" value={stats.notStarted} />
            <Kpi label="In review" value={stats.inReview} tone="orange" />
            <Kpi label="Completed" value={stats.completed} tone="green" />
            <Kpi label="Overdue" value={stats.overdue} tone={stats.overdue ? "red" : "neutral"} />
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="Task list"
              description="Completing a recurring task automatically creates its next scheduled occurrence."
            />
            {rows.length === 0 ? (
              <EmptyState
                icon={<CheckSquare />}
                title="No tasks yet"
                description={manager ? "Create the first task to get started." : "Nothing assigned to you right now."}
                action={manager ? <NewTaskButton options={options} /> : undefined}
              />
            ) : (
              <TaskList tasks={rows} options={options} />
            )}
          </Card>
        </>
      ) : (
        <TeamPerformance tasks={tasks} people={people} />
      )}
    </>
  );
}

type TaskWithAssignee = {
  assigneeId: string;
  status: string;
  dueDate: Date;
  completedAt: Date | null;
  daysLate: number | null;
};

function TeamPerformance({
  tasks,
  people,
}: {
  tasks: TaskWithAssignee[];
  people: { id: string; name: string; role: string }[];
}) {
  const rows = people
    .map((person) => ({ person, ...performanceFor(tasks.filter((t) => t.assigneeId === person.id)) }))
    .filter((r) => r.assigned > 0);

  if (!rows.length) {
    return (
      <Card>
        <EmptyState title="No tasks assigned yet" description="Performance appears once the team has tasks." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ person, ...p }) => (
          <Card key={person.id} className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{person.name}</p>
              <p className="tabular text-sm text-muted">
                {p.completed} / {p.assigned}
              </p>
            </div>
            <p className="tabular mt-3 text-2xl font-semibold text-brand">{p.onTimePct}%</p>
            <p className="text-xs text-muted">on time</p>
            <Progress value={p.completionPct} className="mt-3" />
            <p className="mt-1.5 text-xs text-muted">{p.completionPct}% of tasks completed</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-[13px]">
              <Stat label="Late" value={p.late} tone={p.late ? "text-[var(--red)]" : undefined} />
              <Stat label="Overdue" value={p.overdue} tone={p.overdue ? "text-[var(--red)]" : undefined} />
              <Stat label="In review" value={p.inReview} />
              <Stat label="Blocked" value={p.blocked} tone={p.blocked ? "text-[var(--red)]" : undefined} />
            </dl>
            {p.avgDaysLate > 0 && <p className="mt-2 text-xs text-muted">Average {p.avgDaysLate} days late when late</p>}
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Team comparison" description="Descriptive numbers — no scores, no ranking." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-3 py-2.5 text-right font-medium">Assigned</th>
                <th className="px-3 py-2.5 text-right font-medium">Completed</th>
                <th className="px-3 py-2.5 text-right font-medium">In review</th>
                <th className="px-3 py-2.5 text-right font-medium">Blocked</th>
                <th className="px-3 py-2.5 text-right font-medium">Late</th>
                <th className="px-3 py-2.5 text-right font-medium">Overdue</th>
                <th className="px-3 py-2.5 text-right font-medium">On-time</th>
                <th className="px-4 py-2.5 text-right font-medium">Completion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ person, ...p }) => (
                <tr key={person.id} className="hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 font-medium">{person.name}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.assigned}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.completed}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.inReview}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.blocked}</td>
                  <td className={cn("tabular px-3 py-2.5 text-right", p.late && "text-[var(--red)]")}>{p.late}</td>
                  <td className={cn("tabular px-3 py-2.5 text-right", p.overdue && "text-[var(--red)]")}>{p.overdue}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.onTimePct}%</td>
                  <td className="tabular px-4 py-2.5 text-right">{pct(p.completed, p.assigned)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular font-medium", tone)}>{value}</dd>
    </div>
  );
}
