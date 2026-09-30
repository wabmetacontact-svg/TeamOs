import type { Metadata } from "next";
import { AlertTriangle, CheckSquare, Inbox } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { listTasks, myDay, taskCounts } from "@/lib/tasks";
import { dateOnly } from "@/lib/task-rules";
import { can, clientIdScope } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { NewTaskButton } from "./new-task-button";
import { TaskFilters } from "./task-filters";
import { TaskRow } from "./task-row";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v ? v : undefined;
  };

  const view = one("view") ?? "day";
  const timeZone = user.timezone;

  const db = tenantDb(user.tenantId);
  const [people, clients, brands, counts] = await Promise.all([
    db.user.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({
      where: { ...clientIdScope(scope), deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    taskCounts(scope, timeZone),
  ]);

  // What every row needs. The date is already a string by the time it gets
  // there, so the timezone does not travel with it.
  const shared = {
    currentUserId: user.id,
    canEdit: can(scope, "task:edit"),
    canVerify: can(scope, "task:verify"),
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          view === "day"
            ? "What is on you, in the order it should be dealt with. Overdue first — a list that puts today above last week lets things rot."
            : "Everything the workspace is carrying. A task with no client is internal work and everybody can see it."
        }
        actions={can(scope, "task:create") && <NewTaskButton people={people} clients={clients} brands={brands} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 rounded-lg border border-border bg-surface-2 p-1">
          <ViewTab href="/tasks?view=day" label="My day" active={view === "day"} count={counts.mine} />
          <ViewTab href="/tasks?view=all" label="Everything" active={view === "all"} count={counts.open} />
        </div>

        {counts.overdue > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-[var(--red)]">
            <AlertTriangle className="size-4" />
            {counts.overdue} overdue
          </span>
        )}
      </div>

      {view === "day" ? (
        <MyDay scope={scope} shared={shared} timeZone={timeZone} />
      ) : (
        <Everything
          scope={scope}
          shared={shared}
          timeZone={timeZone}
          clients={clients}
          people={people}
          filters={{
            status: one("status"),
            assigneeId: one("assignee"),
            clientId: one("client"),
            priority: one("priority"),
            q: one("q"),
            overdueOnly: one("overdue") === "1",
            openOnly: !one("status"),
          }}
        />
      )}
    </>
  );
}

function ViewTab({ href, label, active, count }: { href: string; label: string; active: boolean; count: number }) {
  return (
    <a
      href={href}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"
      }`}
    >
      {label}
      <span className={active ? "text-muted" : "text-subtle"}>{count}</span>
    </a>
  );
}

type Shared = {
  currentUserId: string;
  canEdit: boolean;
  canVerify: boolean;
};

async function MyDay({
  scope,
  shared,
  timeZone,
}: {
  scope: Parameters<typeof myDay>[0];
  shared: Shared;
  timeZone: string;
}) {
  const day = await myDay(scope, timeZone);
  const nothing = day.overdue.length + day.dueToday.length + day.upcoming.length + day.waiting.length === 0;

  if (nothing) {
    return (
      <Card>
        <EmptyState
          icon={<CheckSquare />}
          title="Nothing on you"
          description="No open tasks assigned to you this week. Either you are ahead, or nobody has given you anything."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Section title="Overdue" tone="red" tasks={day.overdue} shared={shared} timeZone={timeZone} />
      <Section title={`Due today · ${day.today}`} tone="blue" tasks={day.dueToday} shared={shared} timeZone={timeZone} />
      <Section title="This week" tone="grey" tasks={day.upcoming} shared={shared} timeZone={timeZone} />
      <Section title="Waiting on your review" tone="orange" tasks={day.waiting} shared={shared} timeZone={timeZone} />
    </div>
  );
}

async function Everything({
  scope,
  shared,
  timeZone,
  clients,
  people,
  filters,
}: {
  scope: Parameters<typeof listTasks>[0];
  shared: Shared;
  timeZone: string;
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  filters: Parameters<typeof listTasks>[1];
}) {
  const tasks = await listTasks(scope, filters, timeZone);

  return (
    <>
      <TaskFilters clients={clients} people={people} />

      {tasks.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={<Inbox />} title="Nothing matches" description="Try clearing the filters." />
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden">
          <div className="divide-y divide-border">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={serialise(task, timeZone)} {...shared} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Section({
  title,
  tone,
  tasks,
  shared,
  timeZone,
}: {
  title: string;
  tone: "red" | "blue" | "grey" | "orange";
  tasks: Awaited<ReturnType<typeof listTasks>>;
  shared: Shared;
  timeZone: string;
}) {
  if (tasks.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge tone={tone}>{tasks.length}</Badge>
      </div>
      <div className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={serialise(task, timeZone)} {...shared} />
        ))}
      </div>
    </Card>
  );
}

/** Dates and counts flattened for the client component. */
function serialise(task: Awaited<ReturnType<typeof listTasks>>[number], timeZone: string) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    priority: task.priority,
    dueDate: dateOnly(task.dueDate, timeZone),
    assigneeId: task.assigneeId,
    assigneeName: task.assignee.name,
    assignedById: task.assignedById,
    clientName: task.client?.name ?? null,
    brandName: task.brand?.name ?? null,
    relationshipLabel: task.relationship ? `${task.relationship.person.name} · ${task.relationship.context.name}` : null,
    category: task.category,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    daysLate: task.daysLate,
    isPrivate: task.isPrivate,
    recurring: task.recurring,
    frequency: task.frequency,
    verifiedByName: task.verifiedBy?.name ?? null,
  };
}
