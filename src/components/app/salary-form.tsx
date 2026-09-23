"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SALARY_STATUSES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { deleteSalary, markSalaryPaid, saveSalary, type SalaryInput } from "@/app/(app)/salaries/actions";

export type SalaryValues = {
  id?: string;
  employeeName?: string;
  amount?: number;
  month?: string;
  paymentDate?: Date | string | null;
  amountPaid?: number;
  status?: string;
  notes?: string | null;
};

export function SalaryFormDialog({
  month,
  people,
  values = {},
  trigger,
}: {
  month: string;
  people: string[];
  values?: SalaryValues;
  trigger: React.ReactNode;
}) {
  const editing = !!values.id;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>();
  const [status, setStatus] = useState(values.status ?? "Pending");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={editing ? "Edit salary" : "Add salary"}
        description="Marking a salary paid automatically records the expense — you never enter it twice."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as SalaryInput;
            start(async () => {
              const res = await saveSalary(values.id ?? null, fd);
              if (!res.ok) {
                setErrors(res.fieldErrors);
                return void toast.error(res.error);
              }
              setErrors(undefined);
              setOpen(false);
              toast.success(res.message ?? "Saved");
            });
          }}
        >
          <Field label="Employee / person" htmlFor="s-name" required error={errors?.employeeName?.[0]}>
            <Input id="s-name" name="employeeName" list="salary-people" defaultValue={values.employeeName} placeholder="Jasleen" required autoFocus />
            <datalist id="salary-people">
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly salary (₹)" htmlFor="s-amount" required error={errors?.amount?.[0]}>
              <Input
                id="s-amount"
                name="amount"
                type="number"
                min="0"
                step="1"
                defaultValue={values.amount ? values.amount / 100 : ""}
                placeholder="30000"
                required
              />
            </Field>
            <Field label="Salary month" htmlFor="s-month" required error={errors?.month?.[0]}>
              <Input id="s-month" name="month" type="month" defaultValue={values.month ?? month} required />
            </Field>
            <Field label="Status" htmlFor="s-status">
              <Select id="s-status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {SALARY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment date" htmlFor="s-date" hint={status === "Pending" ? "Set when it is paid" : "Blank = today"}>
              <Input id="s-date" name="paymentDate" type="date" defaultValue={toDateInput(values.paymentDate)} />
            </Field>
            {status === "Partially Paid" && (
              <Field label="Amount paid (₹)" htmlFor="s-paid" required>
                <Input id="s-paid" name="amountPaid" type="number" min="0" step="1" defaultValue={values.amountPaid ? values.amountPaid / 100 : ""} required />
              </Field>
            )}
          </div>

          <Field label="Notes" htmlFor="s-notes">
            <Textarea id="s-notes" name="notes" defaultValue={values.notes ?? ""} placeholder="September salary" />
          </Field>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing ? "Save changes" : "Add salary"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddSalaryButton({ month, people }: { month: string; people: string[] }) {
  return (
    <SalaryFormDialog
      month={month}
      people={people}
      trigger={
        <Button variant="primary">
          <Plus /> Add salary
        </Button>
      }
    />
  );
}

export function SalaryRowActions({
  salary,
  month,
  people,
}: {
  salary: SalaryValues & { id: string; employeeName: string };
  month: string;
  people: string[];
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1.5">
      {salary.status !== "Paid" && (
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await markSalaryPaid(salary.id);
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message ?? "Marked paid");
            })
          }
        >
          <Check /> Mark paid
        </Button>
      )}
      <SalaryFormDialog
        month={month}
        people={people}
        values={salary}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${salary.employeeName}`}>
            <Pencil />
          </Button>
        }
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${salary.employeeName}`}
        loading={pending}
        onClick={() => {
          if (!confirm(`Delete the salary record for ${salary.employeeName}? Its expense will be removed too.`)) return;
          start(async () => {
            const res = await deleteSalary(salary.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success(res.message ?? "Deleted");
          });
        }}
      >
        {!pending && <Trash2 />}
      </Button>
    </div>
  );
}
