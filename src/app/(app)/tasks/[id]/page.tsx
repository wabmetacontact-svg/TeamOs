import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, Repeat, ShieldCheck } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getTask } from "@/lib/tasks";
import { dateOnly, isOverdue, nextDueDate } from "@/lib/task-rules";
import { can, clientIdScope, NotFoundError } from "@/lib/scope";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { TaskEditor } from "./task-editor";
import { TaskHistory } from "./task-history";

export async function generateMetadata({ params }: PageProps<"/tasks/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { scope } = await requireScope();
  try {
    const task = await getTask(scope, id);
    return { title: task.name };
  } catch {
    return { title: "Not found" };
  }
}

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const { user, scope } = await requireScope();

  let task;
  try {
    task = await getTask(scope, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const timeZone = user.timezone;
  const db = tenantDb(user.tenantId);

  const [people, clients, brands] = await Promise.all([
    db.user.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({
      where: { ...clientIdScope(scope), deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const due = dateOnly(task.dueDate, timeZone);
  const overdue = isOverdue(task.dueDate, task.status, timeZone);
  const completedBy = task.statusHistory.find((h) => h.toStatus === "Completed");

  // What the next occurrence would be, shown before it happens so nobody is
  // surprised by the date it lands on.
  const upcoming = task.recurring && !task.nextCreated ? nextDueDate(task.dueDate, task, timeZone) : null;

  const mine = task.assigneeId === user.id;

  return (
    <>
      <Link href="/tasks" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Tasks
      </Link>

      <PageHeader
        title={task.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(task.status)}>{task.status}</Badge>
            <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
            {overdue && <Badge tone="red">Overdue</Badge>}
            {task.daysLate != null && task.daysLate > 0 && (
              <Badge tone="red">
                {task.daysLate} {task.daysLate === 1 ? "day" : "days"} late
              </Badge>
            )}
            {task.isPrivate && (
              <Badge tone="grey">
                <Lock className="size-3" /> Private
              </Badge>
            )}
            {task.recurring && (
              <Badge tone="blue">
                <Repeat className="size-3" /> {task.frequency}
              </Badge>
            )}
            {task.verifiedBy && (
              <Badge tone="green">
                <ShieldCheck className="size-3" /> Verified by {task.verifiedBy.name}
              </Badge>
            )}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Task"
              description={can(scope, "task:edit") ? "Changing the due date does not move an existing next occurrence" : undefined}
            />
            <CardBody>
              <TaskEditor
                canEdit={can(scope, "task:edit")}
                canDelete={can(scope, "task:delete")}
                canVerify={can(scope, "task:verify") && task.status === "Completed" && !task.verifiedById && !mine}
                people={people}
                clients={clients}
                brands={brands}
                task={{
                  id: task.id,
                  name: task.name,
                  assigneeId: task.assigneeId,
                  dueDate: due,
                  estimatedMinutes: task.estimatedMinutes,
                  priority: task.priority,
                  clientId: task.clientId ?? "",
                  brandId: task.brandId ?? "",
                  category: task.category ?? "",
                  notes: task.notes ?? "",
                  docUrl: task.docUrl ?? "",
                  isPrivate: task.isPrivate,
                  recurring: task.recurring,
                  frequency: task.frequency ?? "Daily",
                  weekday: task.weekday ?? 1,
                  recurringEnd: task.recurringEnd ? dateOnly(task.recurringEnd, timeZone) : "",
                  status: task.status,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Every move, with who made it" />
            <CardBody>
              <TaskHistory
                entries={task.statusHistory.map((h) => ({
                  id: h.id,
                  from: h.fromStatus,
                  to: h.toStatus,
                  actor: h.actor.name,
                  createdAt: h.createdAt.toISOString(),
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Detail" />
            <CardBody className="grid gap-2 text-sm">
              <Row label="Due" value={due} />
              <Row label="On" value={task.assignee.name} />
              <Row label="Put there by" value={task.assignedBy.name} />
              {task.client && <Row label="Client" value={task.client.name} />}
              {task.brand && <Row label="Brand" value={task.brand.name} />}
              {task.relationship && (
                <Row
                  label="Relationship"
                  value={`${task.relationship.person.name} · ${task.relationship.context.name}`}
                />
              )}
              <Row label="Estimated" value={`${task.estimatedMinutes} minutes`} />
              {task.actualMinutes != null && (
                <Row
                  label="Actual"
                  value={`${task.actualMinutes} minutes${
                    task.actualMinutes > task.estimatedMinutes
                      ? ` · ${Math.round((task.actualMinutes / task.estimatedMinutes - 1) * 100)}% over`
                      : ""
                  }`}
                />
              )}
              {completedBy && <Row label="Completed by" value={completedBy.actor.name} />}
            </CardBody>
          </Card>

          {task.recurring && (
            <Card>
              <CardHeader title="Repeats" description={task.frequency ?? undefined} />
              <CardBody className="grid gap-2 text-sm">
                {task.nextCreated ? (
                  <p className="text-muted">The next one has already been created.</p>
                ) : upcoming ? (
                  <>
                    <Row label="Next will be due" value={dateOnly(upcoming, timeZone)} />
                    <p className="text-xs text-muted">
                      Dated from this one&rsquo;s due date, not from when it is finished — so falling behind does not
                      erase the occurrences that were missed.
                    </p>
                  </>
                ) : (
                  <p className="text-muted">This is the last one in the series.</p>
                )}
                {task.recurringEnd && <Row label="Series ends" value={dateOnly(task.recurringEnd, timeZone)} />}
              </CardBody>
            </Card>
          )}

          {task.status === "Completed" && !task.verifiedById && (
            <Card className="border-orange-200">
              <CardBody className="text-sm">
                <p className="font-medium">Waiting on a second pair of eyes</p>
                <p className="mt-1 text-muted">
                  {mine
                    ? "You completed this, so somebody else has to verify it. That is the whole value of the step."
                    : "Nobody has verified it yet."}
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function priorityTone(priority: string): Tone {
  return priority === "Urgent" ? "red" : priority === "High" ? "orange" : priority === "Low" ? "grey" : "blue";
}

function statusTone(status: string): Tone {
  return status === "Completed"
    ? "green"
    : status === "Blocked"
      ? "red"
      : status === "In Review"
        ? "orange"
        : status === "In Progress"
          ? "blue"
          : "grey";
}
