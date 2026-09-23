"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatMoney, toPaise, usdtToPaise } from "@/lib/money";
import { toDateInput } from "@/lib/dates";
import { createTransaction, updateTransaction, type TransactionInput } from "@/app/(app)/transactions/actions";

export type LedgerOptions = {
  expenseCategories: { id: string; name: string }[];
  incomeSources: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  payees: string[];
  today: string;
};

export type TransactionValues = {
  id?: string;
  type?: "INCOME" | "EXPENSE";
  date?: Date | string;
  categoryId?: string | null;
  name?: string;
  clientId?: string | null;
  usdt?: number | null;
  rate?: number | null;
  amount?: number;
  status?: string;
  notes?: string | null;
};

export function TransactionFormDialog({
  type,
  options,
  values = {},
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  type: "INCOME" | "EXPENSE";
  options: LedgerOptions;
  values?: TransactionValues;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const editing = !!values.id;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>();

  const income = type === "INCOME";
  const [inUsdt, setInUsdt] = useState(income && !!values.usdt);
  const [usdt, setUsdt] = useState(values.usdt ? String(values.usdt) : "");
  const [rate, setRate] = useState(values.rate ? String(values.rate) : "");
  const [amount, setAmount] = useState(values.amount ? String(values.amount / 100) : "");

  const previewPaise = inUsdt ? usdtToPaise(Number(usdt || 0), Number(rate || 0)) : toPaise(amount);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as TransactionInput;
    start(async () => {
      const res = editing ? await updateTransaction(values.id!, fd) : await createTransaction(fd);
      if (!res.ok) {
        setErrors(res.fieldErrors);
        return void toast.error(res.error);
      }
      setErrors(undefined);
      setOpen(false);
      toast.success(res.message ?? "Saved");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        title={editing ? (income ? "Edit income" : "Edit expense") : income ? "Add income" : "Add expense"}
        description={income ? "Money received. USDT is converted to ₹ for you." : "Money paid out, with the category and who it went to."}
      >
        <form onSubmit={onSubmit} className="grid gap-4">
          <input type="hidden" name="type" value={type} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="tx-date" required error={errors?.date?.[0]}>
              <Input id="tx-date" name="date" type="date" defaultValue={toDateInput(values.date ?? options.today)} required />
            </Field>
            <Field label={income ? "Income source" : "Category"} htmlFor="tx-cat" required error={errors?.categoryId?.[0]}>
              <Select id="tx-cat" name="categoryId" defaultValue={values.categoryId ?? ""} required>
                <option value="" disabled>
                  Select
                </option>
                {(income ? options.incomeSources : options.expenseCategories).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label={income ? "Received from" : "Name / payee"}
            htmlFor="tx-name"
            required
            hint={income ? "Who paid you" : "Who the money went to, e.g. Jasleen or Swiggy"}
            error={errors?.name?.[0]}
          >
            <Input id="tx-name" name="name" list="payees" defaultValue={values.name} placeholder={income ? "ARC3" : "Jasleen"} required />
            <datalist id="payees">
              {options.payees.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

          {income && options.clients.length > 0 && (
            <Field label="Client" htmlFor="tx-client" hint="Links this payment to a client's account">
              <Select id="tx-client" name="clientId" defaultValue={values.clientId ?? ""}>
                <option value="">No client</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {income && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={inUsdt} onChange={(e) => setInUsdt(e.target.checked)} className="size-4 accent-[var(--blue)]" />
              Received in USDT
            </label>
          )}

          {inUsdt ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="USDT received" htmlFor="tx-usdt" required>
                <Input id="tx-usdt" name="usdt" type="number" step="0.01" min="0" value={usdt} onChange={(e) => setUsdt(e.target.value)} placeholder="1000" required />
              </Field>
              <Field label="USDT → INR rate" htmlFor="tx-rate" required>
                <Input id="tx-rate" name="rate" type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="100" required />
              </Field>
            </div>
          ) : (
            <Field label="Amount (₹)" htmlFor="tx-amount" required error={errors?.amount?.[0]}>
              <Input id="tx-amount" name="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30000" required />
            </Field>
          )}

          {previewPaise > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
              <span className="text-sm text-muted">{inUsdt ? "INR received" : income ? "Income" : "Expense"}</span>
              <span className={`tabular text-lg font-semibold ${income ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {income ? "+" : "−"}
                {formatMoney(previewPaise)}
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="tx-status">
              <Select id="tx-status" name="status" defaultValue={values.status ?? (income ? "Received" : "Paid")}>
                {income ? (
                  <>
                    <option value="Received">Received</option>
                    <option value="Pending">Pending</option>
                  </>
                ) : (
                  <>
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending</option>
                  </>
                )}
              </Select>
            </Field>
          </div>

          <Field label="Notes" htmlFor="tx-notes">
            <Textarea id="tx-notes" name="notes" defaultValue={values.notes ?? ""} placeholder="Optional" />
          </Field>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing ? "Save changes" : income ? "Save income" : "Save expense"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddIncomeButton({ options }: { options: LedgerOptions }) {
  return (
    <TransactionFormDialog
      type="INCOME"
      options={options}
      trigger={
        <Button variant="secondary">
          <ArrowDownLeft className="text-[var(--green)]" /> Income
        </Button>
      }
    />
  );
}

export function AddExpenseButton({ options }: { options: LedgerOptions }) {
  return (
    <TransactionFormDialog
      type="EXPENSE"
      options={options}
      trigger={
        <Button variant="primary">
          <ArrowUpRight /> Expense
        </Button>
      }
    />
  );
}
