"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Check, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TASK_FREQUENCIES, TASK_PRIORITIES } from "@/lib/task-rules";
import { deleteTask, updateTask, verifyTask } from "../actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type TaskValues = {
  id: string;
  name: string;
  assigneeId: string;
  dueDate: string;
  estimatedMinutes: number;
  priority: string;
  clientId: string;
  brandId: string;
  category: string;
  notes: string;
  docUrl: string;
  isPrivate: boolean;
  recurring: boolean;
  frequency: string;
  weekday: number;
  recurringEnd: string;
  status: string;
};

export function TaskEditor({
  task,
  people,
  clients,
  brands,
  canEdit,
  canDelete,
  canVerify,
}: {
  task: TaskValues;
  people: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canVerify: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const [recurring, setRecurring] = useState(task.recurring);
  const [frequency, setFrequency] = useState(task.frequency);
  const [isPrivate, setIsPrivate] = useState(task.isPrivate);
  const [confirming, setConfirming] = useState(false);

  if (!canEdit) return <ReadOnly task={task} people={people} clients={clients} />;

  return (
    <div className="grid gap-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <form
        action={(formData) =>
          start(async () => {
            setError(null);
            setErrors({});
            setSaved(false);

            const result = await updateTask({
              id: task.id,
              name: String(formData.get("name") ?? ""),
              assigneeId: String(formData.get("assigneeId") ?? ""),
              dueDate: String(formData.get("dueDate") ?? ""),
              estimatedMinutes: Number(formData.get("estimatedMinutes") ?? 0),
              priority: String(formData.get("priority") ?? "Medium") as (typeof TASK_PRIORITIES)[number],
              clientId: String(formData.get("clientId") ?? "") || undefined,
              brandId: String(formData.get("brandId") ?? "") || undefined,
              category: String(formData.get("category") ?? "") || undefined,
              notes: String(formData.get("notes") ?? "") || undefined,
              docUrl: String(formData.get("docUrl") ?? "") || undefined,
              isPrivate,
              recurring,
              frequency: recurring ? (frequency as (typeof TASK_FREQUENCIES)[number]) : undefined,
              weekday: recurring && frequency === "Weekly" ? Number(formData.get("weekday") ?? 1) : undefined,
              recurringEnd: String(formData.get("recurringEnd") ?? "") || undefined,
            });

            if (result.ok) {
              setSaved(true);
              router.refresh();
            } else {
              setError(result.error);
              setErrors(result.fieldErrors ?? {});
            }
          })
        }
        className="grid gap-4"
      >
        <Field label="What needs doing" htmlFor="e-name" error={errors.name?.[0]} required>
          <Input id="e-name" name="name" defaultValue={task.name} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="On whom" htmlFor="e-assignee" error={errors.assigneeId?.[0]} required>
            <Select id="e-assignee" name="assigneeId" defaultValue={task.assigneeId} required>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due" htmlFor="e-due" error={errors.dueDate?.[0]} required>
            <Input id="e-due" name="dueDate" type="date" defaultValue={task.dueDate} required />
          </Field>

          <Field label="Estimate (minutes)" htmlFor="e-estimate" error={errors.estimatedMinutes?.[0]} required>
            <Input
              id="e-estimate"
              name="estimatedMinutes"
              type="number"
              min={1}
              defaultValue={task.estimatedMinutes}
              required
              className="tabular-nums"
            />
          </Field>

          <Field label="Priority" htmlFor="e-priority">
            <Select id="e-priority" name="priority" defaultValue={task.priority}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Client" htmlFor="e-client" hint="Empty means internal work">
            <Select id="e-client" name="clientId" defaultValue={task.clientId}>
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Brand" htmlFor="e-brand">
            <Select id="e-brand" name="brandId" defaultValue={task.brandId}>
              <option value="">None</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Category" htmlFor="e-category">
            <Input id="e-category" name="category" defaultValue={task.category} placeholder="Reporting" />
          </Field>

          <Field label="Link" htmlFor="e-doc">
            <Input id="e-doc" name="docUrl" defaultValue={task.docUrl} placeholder="https://…" />
          </Field>
        </div>

        <Field label="Notes" htmlFor="e-notes">
          <Textarea id="e-notes" name="notes" defaultValue={task.notes} />
        </Field>

        <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.currentTarget.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            Repeats
          </label>

          {recurring && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="How often" htmlFor="e-freq">
                <Select id="e-freq" value={frequency} onChange={(e) => setFrequency(e.currentTarget.value)}>
                  {TASK_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>

              {frequency === "Weekly" && (
                <Field label="On" htmlFor="e-weekday">
                  <Select id="e-weekday" name="weekday" defaultValue={String(task.weekday)}>
                    {WEEKDAYS.map((day, i) => (
                      <option key={day} value={i}>
                        {day}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Until" htmlFor="e-end" hint="Optional">
                <Input id="e-end" name="recurringEnd" type="date" defaultValue={task.recurringEnd} />
              </Field>
            </div>
          )}

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.currentTarget.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            Private — only on yourself
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={pending}>
            Save changes
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="size-4" />
              Saved
            </span>
          )}

          {canVerify && (
            <Button
              type="button"
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

          {canDelete &&
            (confirming ? (
              <span className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await deleteTask({ id: task.id });
                      if (result.ok) router.push("/tasks");
                      else setError(result.error);
                    })
                  }
                >
                  Remove it
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
                onClick={() => setConfirming(true)}
              >
                <Trash2 />
                Remove
              </Button>
            ))}
        </div>
      </form>
    </div>
  );
}

function ReadOnly({
  task,
  people,
  clients,
}: {
  task: TaskValues;
  people: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const rows: [string, string][] = [
    ["On", people.find((p) => p.id === task.assigneeId)?.name ?? ""],
    ["Due", task.dueDate],
    ["Priority", task.priority],
    ["Client", clients.find((c) => c.id === task.clientId)?.name ?? ""],
    ["Category", task.category],
    ["Estimate", `${task.estimatedMinutes} minutes`],
  ];

  return (
    <div className="grid gap-2 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      {task.notes && <p className="mt-2 whitespace-pre-wrap border-t border-border pt-3 text-muted">{task.notes}</p>}
    </div>
  );
}
