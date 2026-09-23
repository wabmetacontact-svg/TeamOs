"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { IndianRupee, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CLIENT_STATUSES } from "@/lib/constants";
import { formatMoney, toPaise, usdtToPaise } from "@/lib/money";
import { saveClient, recordClientPayment, type ClientInput, type ClientPaymentInput } from "@/app/(app)/clients/actions";

export type ClientValues = {
  id?: string;
  name?: string;
  company?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  project?: string | null;
  contractValue?: number | null;
  paymentTerms?: string | null;
  status?: string;
  notes?: string | null;
};

export function ClientFormDialog({ values = {}, trigger }: { values?: ClientValues; trigger: React.ReactNode }) {
  const editing = !!values.id;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={editing ? "Edit client" : "Add client"}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as ClientInput;
            start(async () => {
              const res = await saveClient(values.id ?? null, fd);
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" htmlFor="c-name" required error={errors?.name?.[0]}>
              <Input id="c-name" name="name" defaultValue={values.name} placeholder="ARC3" required autoFocus />
            </Field>
            <Field label="Company" htmlFor="c-company">
              <Input id="c-company" name="company" defaultValue={values.company ?? ""} />
            </Field>
            <Field label="Contact person" htmlFor="c-contact">
              <Input id="c-contact" name="contactPerson" defaultValue={values.contactPerson ?? ""} />
            </Field>
            <Field label="Email" htmlFor="c-email" error={errors?.email?.[0]}>
              <Input id="c-email" name="email" type="email" defaultValue={values.email ?? ""} />
            </Field>
            <Field label="Phone" htmlFor="c-phone">
              <Input id="c-phone" name="phone" defaultValue={values.phone ?? ""} />
            </Field>
            <Field label="Service / project" htmlFor="c-project">
              <Input id="c-project" name="project" defaultValue={values.project ?? ""} placeholder="Consulting" />
            </Field>
            <Field label="Contract value (₹)" htmlFor="c-value" hint="Total deal value, optional">
              <Input id="c-value" name="contractValue" type="number" min="0" defaultValue={values.contractValue ? values.contractValue / 100 : ""} />
            </Field>
            <Field label="Payment terms" htmlFor="c-terms">
              <Input id="c-terms" name="paymentTerms" defaultValue={values.paymentTerms ?? ""} placeholder="Monthly" />
            </Field>
            <Field label="Status" htmlFor="c-status">
              <Select id="c-status" name="status" defaultValue={values.status ?? "Active"}>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="c-notes">
            <Textarea id="c-notes" name="notes" defaultValue={values.notes ?? ""} />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing ? "Save changes" : "Add client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddClientButton() {
  return (
    <ClientFormDialog
      trigger={
        <Button variant="primary">
          <Plus /> Add client
        </Button>
      }
    />
  );
}

export function EditClientButton({ client }: { client: ClientValues }) {
  return (
    <ClientFormDialog
      values={client}
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil /> Edit
        </Button>
      }
    />
  );
}

/** Recording a payment writes straight into the ledger as income. */
export function RecordPaymentDialog({
  clients,
  defaultClientId,
  today,
  trigger,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
  today: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [currency, setCurrency] = useState<"INR" | "USDT">("USDT");
  const [usdt, setUsdt] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");

  const preview = currency === "USDT" ? usdtToPaise(Number(usdt || 0), Number(rate || 0)) : toPaise(amount);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="primary">
            <IndianRupee /> Record payment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="Record client payment" description="This becomes an income entry in the ledger — no double entry.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as ClientPaymentInput;
            start(async () => {
              const res = await recordClientPayment(fd);
              if (!res.ok) return void toast.error(res.error);
              setOpen(false);
              setUsdt("");
              setRate("");
              setAmount("");
              toast.success(res.message ?? "Payment recorded");
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="p-client" required>
              <Select id="p-client" name="clientId" defaultValue={defaultClientId ?? ""} required>
                <option value="" disabled>
                  Select a client
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="p-date" required>
              <Input id="p-date" name="date" type="date" defaultValue={today} required />
            </Field>
            <Field label="Currency" htmlFor="p-currency">
              <Select id="p-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as "INR" | "USDT")}>
                <option value="USDT">USDT</option>
                <option value="INR">INR</option>
              </Select>
            </Field>
            <Field label="Payment status" htmlFor="p-status">
              <Select id="p-status" name="status" defaultValue="Received">
                <option value="Received">Received</option>
                <option value="Pending">Pending</option>
              </Select>
            </Field>
            {currency === "USDT" ? (
              <>
                <Field label="USDT amount" htmlFor="p-usdt" required>
                  <Input id="p-usdt" name="usdt" type="number" step="0.01" min="0" value={usdt} onChange={(e) => setUsdt(e.target.value)} placeholder="1000" required />
                </Field>
                <Field label="Conversion rate (₹)" htmlFor="p-rate" required>
                  <Input id="p-rate" name="rate" type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="100" required />
                </Field>
              </>
            ) : (
              <Field label="Amount (₹)" htmlFor="p-amount" required>
                <Input id="p-amount" name="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
            )}
          </div>

          {preview > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
              <span className="text-sm text-muted">INR value</span>
              <span className="tabular text-lg font-semibold text-[var(--green)]">{formatMoney(preview)}</span>
            </div>
          )}

          <Field label="Notes" htmlFor="p-notes">
            <Textarea id="p-notes" name="notes" placeholder="September payment" />
          </Field>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Record payment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
