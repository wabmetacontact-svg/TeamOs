"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TASK_STATUSES, WEEKDAYS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { createTask, updateTask, type TaskInput } from "@/app/(app)/tasks/actions";

export type TaskFormOptions = {
  assignees: { id: string; name: string }[];
  verifiers: { id: string; name: string }[];
  canManage: boolean;
  today: string;
};

export type TaskFormValues = {
  id?: string;
  name?: string;
  assigneeId?: string;
  status?: string;
  dueDate?: Date | string;
  completedAt?: Date | string | null;
  verifiedById?: string | null;
  docUrl?: string | null;
  notes?: string | null;
  recurring?: boolean;
  frequency?: string | null;
  weekday?: number | null;
  recurringStart?: Date | string | null;
  recurringEnd?: Date | string | null;
};

export function TaskFormDialog({
  options,
  values = {},
  trigger,
}: {
  options: TaskFormOptions;
  values?: TaskFormValues;
  trigger: React.ReactNode;
}) {
  const editing = !!values.id;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>();
  const [status, setStatus] = useState(values.status ?? "Not Started");
  const [recurring, setRecurring] = useState(values.recurring ?? false);
  const [frequency, setFrequency] = useState(values.frequency ?? "Daily");
  const [dueDate, setDueDate] = useState(toDateInput(values.dueDate ?? options.today));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as TaskInput;
    start(async () => {
      const res = editing ? await updateTask(values.id!, fd) : await createTask(fd);
      if (!res.ok) {
        setErrors(res.fieldErrors);
        return void toast.error(res.error);
      }
      setErrors(undefined);
      setOpen(false);
      toast.success(res.message ?? "Saved");
    });
  }

  const locked = editing && !options.canManage; // members edit only their own progress

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={editing ? "Update task" : "Create task"}
        description={editing ? undefined : "Assign the work and, if it repeats, let it repeat itself."}
      >
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Task name" htmlFor="t-name" required error={errors?.name?.[0]}>
            <Input
              id="t-name"
              name="name"
              defaultValue={values.name}
              placeholder="Complete the $0.80 strategy"
              disabled={locked}
              required
              autoFocus={!editing}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assignee" htmlFor="t-assignee" required error={errors?.assigneeId?.[0]}>
              <Select id="t-assignee" name="assigneeId" defaultValue={values.assigneeId ?? ""} disabled={locked} required>
                <option value="" disabled>
                  Select a person
                </option>
                {options.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="t-due" required error={errors?.dueDate?.[0]}>
              <Input
                id="t-due"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={locked}
                required
              />
            </Field>
            <Field label="Status" htmlFor="t-status">
              <Select id="t-status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Task verified by" htmlFor="t-verified" hint={options.canManage ? undefined : "Managers verify tasks"}>
              <Select id="t-verified" name="verifiedById" defaultValue={values.verifiedById ?? ""} disabled={!options.canManage}>
                <option value="">Not verified</option>
                {options.verifiers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            {status === "Completed" && (
              <Field label="Completed date" htmlFor="t-completed" hint="Blank means today" error={errors?.completedAt?.[0]}>
                <Input id="t-completed" name="completedAt" type="date" defaultValue={toDateInput(values.completedAt)} />
              </Field>
            )}
          </div>

          <Field label="Task submit doc" htmlFor="t-doc" hint="Link to the doc, sheet or published post" error={errors?.docUrl?.[0]}>
            <Input id="t-doc" name="docUrl" type="url" defaultValue={values.docUrl ?? ""} placeholder="https://…" />
          </Field>

          <Field label="Notes" htmlFor="t-notes">
            <Textarea id="t-notes" name="notes" defaultValue={values.notes ?? ""} placeholder="Instructions, context, blockers…" />
          </Field>

          {options.canManage && (
            <div className="rounded-xl border border-border bg-surface-2 p-3.5">
              <label className="flex items-start gap-2.5">
                <input type="hidden" name="recurring" value="false" />
                <input
                  type="checkbox"
                  name="recurring"
                  value="true"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--blue)]"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Repeat className="size-3.5 text-brand" /> Recurring task
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    When it is completed, the next occurrence is created automatically. Future occurrences are never made in advance.
                  </span>
                </span>
              </label>

              {recurring && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Repeat" htmlFor="t-freq">
                    <Select id="t-freq" name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                      <option value="Daily">Daily</option>
                      <option value="Weekly">Weekly</option>
                    </Select>
                  </Field>
                  {frequency === "Weekly" && (
                    <Field label="Weekly day" htmlFor="t-weekday" error={errors?.weekday?.[0]}>
                      <Select id="t-weekday" name="weekday" defaultValue={String(values.weekday ?? 1)}>
                        {WEEKDAYS.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="Start date" htmlFor="t-rstart">
                    <Input id="t-rstart" name="recurringStart" type="date" defaultValue={toDateInput(values.recurringStart) || dueDate} />
                  </Field>
                  <Field label="End date" htmlFor="t-rend" hint="Blank = never ends">
                    <Input id="t-rend" name="recurringEnd" type="date" defaultValue={toDateInput(values.recurringEnd)} />
                  </Field>
                </div>
              )}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing ? "Save changes" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewTaskButton({ options }: { options: TaskFormOptions }) {
  return (
    <TaskFormDialog
      options={options}
      trigger={
        <Button variant="primary">
          <Plus /> New task
        </Button>
      }
    />
  );
}
