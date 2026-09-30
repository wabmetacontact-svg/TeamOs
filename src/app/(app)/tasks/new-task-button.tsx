"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TASK_FREQUENCIES, TASK_PRIORITIES } from "@/lib/task-rules";
import { createTask } from "./actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function NewTaskButton({
  people,
  clients,
  brands,
}: {
  people: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<string>("Daily");
  const [isPrivate, setIsPrivate] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New task
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New task"
        description="An estimate is required now, and an actual when it is completed — an estimate nobody compares against a real number is a number somebody typed to get past a form."
        className="sm:max-w-xl"
      >
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              setErrors({});
              const result = await createTask({
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
                setOpen(false);
                setRecurring(false);
                setIsPrivate(false);
                router.refresh();
              } else {
                setError(result.error);
                setErrors(result.fieldErrors ?? {});
              }
            })
          }
          className="grid gap-4"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          <Field label="What needs doing" htmlFor="t-name" error={errors.name?.[0]} required>
            <Input id="t-name" name="name" placeholder="Send September report to Northwind" required autoFocus />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="On whom" htmlFor="t-assignee" error={errors.assigneeId?.[0]} required>
              <Select id="t-assignee" name="assigneeId" required defaultValue={people[0]?.id}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Due" htmlFor="t-due" error={errors.dueDate?.[0]} required>
              <Input id="t-due" name="dueDate" type="date" defaultValue={today} required />
            </Field>

            <Field
              label="Estimate (minutes)"
              htmlFor="t-estimate"
              error={errors.estimatedMinutes?.[0]}
              hint="Rough is fine — it only matters that it is compared later"
              required
            >
              <Input id="t-estimate" name="estimatedMinutes" type="number" min={1} defaultValue={30} required className="tabular-nums" />
            </Field>

            <Field label="Priority" htmlFor="t-priority">
              <Select id="t-priority" name="priority" defaultValue="Medium">
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Client" htmlFor="t-client" hint="Leave empty for internal work">
              <Select id="t-client" name="clientId" defaultValue="">
                <option value="">None</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Brand" htmlFor="t-brand">
              <Select id="t-brand" name="brandId" defaultValue="">
                <option value="">None</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Category" htmlFor="t-category" hint="Free text — Reporting, Design, Admin">
              <Input id="t-category" name="category" placeholder="Reporting" />
            </Field>

            <Field label="Link" htmlFor="t-doc" hint="A doc, a brief, a thread">
              <Input id="t-doc" name="docUrl" placeholder="https://…" />
            </Field>
          </div>

          <Field label="Notes" htmlFor="t-notes">
            <Textarea id="t-notes" name="notes" placeholder="Anything the person picking this up needs to know." />
          </Field>

          <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.currentTarget.checked)}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                Repeats
                <span className="block text-xs text-muted">
                  The next one is created when this is completed, dated from <em>this one&rsquo;s due date</em> — so a
                  week of late work does not quietly disappear.
                </span>
              </span>
            </label>

            {recurring && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="How often" htmlFor="t-freq">
                  <Select id="t-freq" value={frequency} onChange={(e) => setFrequency(e.currentTarget.value)}>
                    {TASK_FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </Field>

                {frequency === "Weekly" && (
                  <Field label="On" htmlFor="t-weekday">
                    <Select id="t-weekday" name="weekday" defaultValue="1">
                      {WEEKDAYS.map((day, i) => (
                        <option key={day} value={i}>
                          {day}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <Field label="Until" htmlFor="t-end" hint="Optional">
                  <Input id="t-end" name="recurringEnd" type="date" />
                </Field>
              </div>
            )}

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.currentTarget.checked)}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                Private
                <span className="block text-xs text-muted">
                  Only you see it. It can only be on yourself — a private task on somebody else is one they would never
                  find.
                </span>
              </span>
            </label>
          </div>

          <Button type="submit" variant="primary" loading={pending} className="justify-self-start">
            Create task
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
