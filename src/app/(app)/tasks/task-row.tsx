"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, EyeOff, Lock, Repeat, ShieldCheck } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { allowedTransitions } from "@/lib/task-rules";
import { changeTaskStatus, verifyTask } from "./actions";

export type TaskCard = {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string;
  assigneeId: string;
  assigneeName: string;
  assignedById: string;
  clientName: string | null;
  brandName: string | null;
  relationshipLabel: string | null;
  category: string | null;
  estimatedMinutes: number;
  actualMinutes: number | null;
  daysLate: number | null;
  isPrivate: boolean;
  recurring: boolean;
  frequency: string | null;
  verifiedByName: string | null;
};

export function TaskRow({
  task,
  currentUserId,
  canEdit,
  canVerify,
}: {
  task: TaskCard;
  currentUserId: string;
  canEdit: boolean;
  canVerify: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const done = task.status === "Completed";
  const mine = task.assigneeId === currentUserId;
  // Verification is a second pair of eyes, so the person it was on never gets
  // the button. The server refuses it too.
  const mayVerify = canVerify && done && !task.verifiedByName && !mine;

  function move(status: string, actualMinutes?: number) {
    setError(null);
    start(async () => {
      const result = await changeTaskStatus({
        id: task.id,
        status: status as "Not Started" | "In Progress" | "In Review" | "Blocked" | "Completed",
        actualMinutes,
      });
      if (result.ok) {
        setCompleting(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {canEdit && !done && (
          <button
            type="button"
            title="Complete"
            aria-label={`Complete ${task.name}`}
            disabled={pending}
            onClick={() => setCompleting(!completing)}
            className="flex size-5 shrink-0 items-center justify-center rounded border border-border text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-600"
          >
            <Check className="size-3.5" />
          </button>
        )}
        {done && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-emerald-50 text-emerald-600">
            <Check className="size-3.5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/tasks/${task.id}`} className={`truncate text-sm hover:underline ${done ? "text-muted line-through" : "font-medium"}`}>
              {task.name}
            </Link>
            {task.isPrivate && <Lock className="size-3 shrink-0 text-subtle" aria-label="Private" />}
            {task.recurring && <Repeat className="size-3 shrink-0 text-subtle" aria-label={task.frequency ?? "Recurring"} />}
            {task.verifiedByName && <ShieldCheck className="size-3 shrink-0 text-emerald-600" aria-label={`Verified by ${task.verifiedByName}`} />}
          </div>
          <p className="truncate text-xs text-muted">
            {task.dueDate}
            {" · "}
            {task.assigneeName}
            {task.clientName && ` · ${task.clientName}`}
            {task.relationshipLabel && ` · ${task.relationshipLabel}`}
            {task.category && ` · ${task.category}`}
            {done && task.actualMinutes != null && ` · ${task.actualMinutes}m of ${task.estimatedMinutes}m`}
          </p>
        </div>

        {task.daysLate != null && task.daysLate > 0 && (
          <Badge tone="red">
            {task.daysLate}d late
          </Badge>
        )}
        <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
        {!done && <Badge tone={statusTone(task.status)}>{task.status}</Badge>}

        {canEdit && !done && allowedTransitions(task.status).length > 1 && (
          <Select
            aria-label={`Status of ${task.name}`}
            value={task.status}
            disabled={pending}
            onChange={(e) => {
              const next = e.currentTarget.value;
              if (next === "Completed") setCompleting(true);
              else move(next);
            }}
            className="h-8 w-32 text-[13px]"
          >
            <option value={task.status}>{task.status}</option>
            {allowedTransitions(task.status)
              .filter((s) => s !== task.status)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </Select>
        )}

        {mayVerify && (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await verifyTask({ id: task.id });
                if (result.ok) router.refresh();
                else setError(result.error);
              })
            }
          >
            <ShieldCheck />
            Verify
          </Button>
        )}

        {done && !task.verifiedByName && mine && (
          <span className="flex items-center gap-1 text-xs text-subtle" title="Somebody else has to verify this">
            <EyeOff className="size-3" />
            Awaiting review
          </span>
        )}
      </div>

      {completing && (
        <form
          action={(formData) => move("Completed", Number(formData.get("actualMinutes") ?? 0))}
          className="mt-2 flex flex-wrap items-end gap-2 pl-8"
        >
          <label className="grid gap-1 text-xs">
            <span className="text-muted">How long did it actually take? (minutes)</span>
            <input
              name="actualMinutes"
              type="number"
              min={1}
              defaultValue={task.estimatedMinutes}
              required
              autoFocus
              className="h-8 w-40 rounded-lg border border-border bg-surface px-3 text-[13px] tabular-nums outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </label>
          <Button type="submit" size="sm" variant="primary" loading={pending}>
            Complete
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCompleting(false)}>
            Cancel
          </Button>
          <span className="text-xs text-muted">Estimated {task.estimatedMinutes}m</span>
        </form>
      )}

      {error && <p className="mt-2 pl-8 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}

function priorityTone(priority: string): Tone {
  return priority === "Urgent" ? "red" : priority === "High" ? "orange" : priority === "Low" ? "grey" : "blue";
}

function statusTone(status: string): Tone {
  return status === "Blocked" ? "red" : status === "In Review" ? "orange" : status === "In Progress" ? "blue" : "grey";
}
