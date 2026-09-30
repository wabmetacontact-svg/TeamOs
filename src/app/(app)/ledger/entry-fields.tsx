"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "@/lib/ledger-enums";

export type EntryValues = {
  clientId: string;
  direction: "IN" | "OUT";
  name: string;
  date: string;
  bookMonth: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  categoryId: string;
  vendorId: string;
  paymentMethod: string;
  paymentStatus: string;
  description: string;
  tags: string;
};

export type Option = { id: string; name: string; direction?: string; parent?: { name: string } | null };

/**
 * The entry form, shared by the new-entry dialog and the edit page.
 *
 * Two fields here look redundant and are not. `bookMonth` is separate from
 * `date` because an invoice paid on 2 October for September's work belongs in
 * September's book — forcing it into October would make September's total
 * wrong permanently, and September is the month somebody already reported on.
 *
 * `exchangeRate` appears only for a foreign currency, and is required there,
 * because the rate is captured at entry and stored. Nothing recomputes it
 * later, which is what keeps last month's figures still.
 */
export function EntryFields({
  values,
  onChange,
  errors,
  clients,
  categories,
  vendors,
  baseCurrency,
}: {
  values: EntryValues;
  onChange: (patch: Partial<EntryValues>) => void;
  errors: Record<string, string[]>;
  clients: Option[];
  categories: Option[];
  vendors: Option[];
  baseCurrency: string;
}) {
  const err = (key: string) => errors[key]?.[0];
  const foreign = values.currency !== baseCurrency;
  const matching = categories.filter((c) => c.direction === values.direction);
  const impliedMonth = values.date ? values.date.slice(0, 7) : "";
  const monthDiffers = values.bookMonth && impliedMonth && values.bookMonth !== impliedMonth;

  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5 rounded-lg border border-border bg-surface-2 p-1">
        {(["OUT", "IN"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onChange({ direction, categoryId: "" })}
            className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              values.direction === direction ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"
            }`}
          >
            {direction === "OUT" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={values.direction === "OUT" ? "Paid to" : "Received from"}
          htmlFor="e-name"
          error={err("name")}
          required
        >
          <Input
            id="e-name"
            value={values.name}
            onChange={(e) => onChange({ name: e.currentTarget.value })}
            placeholder={values.direction === "OUT" ? "Adobe" : "Alpha Industries"}
            required
            autoFocus
          />
        </Field>

        <Field label="Client" htmlFor="e-client" error={err("clientId")} required>
          <Select id="e-client" value={values.clientId} onChange={(e) => onChange({ clientId: e.currentTarget.value })} required>
            <option value="">Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Amount" htmlFor="e-amount" error={err("amount")} required>
          <div className="flex gap-2">
            <Input
              id="e-amount"
              value={values.amount}
              onChange={(e) => onChange({ amount: e.currentTarget.value })}
              inputMode="decimal"
              placeholder="12,000"
              className="flex-1 tabular-nums"
              required
            />
            <Input
              value={values.currency}
              onChange={(e) => onChange({ currency: e.currentTarget.value.toUpperCase().slice(0, 3) })}
              maxLength={3}
              aria-label="Currency"
              className="w-20 font-mono uppercase"
            />
          </div>
        </Field>

        {foreign ? (
          <Field
            label={`Rate ${values.currency} → ${baseCurrency}`}
            htmlFor="e-rate"
            error={err("exchangeRate")}
            hint="The rate on the day. Stored, never recalculated."
            required
          >
            <Input
              id="e-rate"
              value={values.exchangeRate}
              onChange={(e) => onChange({ exchangeRate: e.currentTarget.value })}
              inputMode="decimal"
              placeholder="83.50"
              className="tabular-nums"
              required
            />
          </Field>
        ) : (
          <Field label="Date" htmlFor="e-date" error={err("date")} required>
            <Input
              id="e-date"
              type="date"
              value={values.date}
              onChange={(e) => onChange({ date: e.currentTarget.value, bookMonth: monthDiffers ? values.bookMonth : "" })}
              required
            />
          </Field>
        )}

        {foreign && (
          <Field label="Date" htmlFor="e-date-2" error={err("date")} required>
            <Input
              id="e-date-2"
              type="date"
              value={values.date}
              onChange={(e) => onChange({ date: e.currentTarget.value, bookMonth: monthDiffers ? values.bookMonth : "" })}
              required
            />
          </Field>
        )}

        <Field
          label="Book month"
          htmlFor="e-month"
          error={err("bookMonth")}
          hint={
            monthDiffers
              ? `Booked to ${values.bookMonth}, not ${impliedMonth}`
              : "Leave blank to use the month of the date"
          }
        >
          <Input
            id="e-month"
            type="month"
            value={values.bookMonth}
            onChange={(e) => onChange({ bookMonth: e.currentTarget.value })}
          />
        </Field>

        <Field label="Category" htmlFor="e-category" error={err("categoryId")}>
          <Select id="e-category" value={values.categoryId} onChange={(e) => onChange({ categoryId: e.currentTarget.value })}>
            <option value="">Uncategorised</option>
            {matching.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parent ? `${c.parent.name} · ${c.name}` : c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={values.direction === "OUT" ? "Vendor" : "Source"} htmlFor="e-vendor">
          <Select id="e-vendor" value={values.vendorId} onChange={(e) => onChange({ vendorId: e.currentTarget.value })}>
            <option value="">None</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Method" htmlFor="e-method">
          <Select id="e-method" value={values.paymentMethod} onChange={(e) => onChange({ paymentMethod: e.currentTarget.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="e-status">
          <Select id="e-status" value={values.paymentStatus} onChange={(e) => onChange({ paymentStatus: e.currentTarget.value })}>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tags" htmlFor="e-tags" hint="Comma separated" className="sm:col-span-2">
          <Input
            id="e-tags"
            value={values.tags}
            onChange={(e) => onChange({ tags: e.currentTarget.value })}
            placeholder="retainer, q4"
          />
        </Field>

        <Field label="Notes" htmlFor="e-description" className="sm:col-span-2">
          <Textarea
            id="e-description"
            value={values.description}
            onChange={(e) => onChange({ description: e.currentTarget.value })}
            placeholder="What this was for, and anything the approver needs."
          />
        </Field>
      </div>
    </div>
  );
}

export function emptyEntry(month: string, currency: string): EntryValues {
  const today = new Date().toISOString().slice(0, 10);
  // If the month being viewed is not the current one, date to the middle of it
  // rather than to today — entering last month's receipts is the common case.
  const date = today.startsWith(month) ? today : `${month}-15`;

  return {
    clientId: "",
    direction: "OUT",
    name: "",
    date,
    bookMonth: "",
    amount: "",
    currency,
    exchangeRate: "",
    categoryId: "",
    vendorId: "",
    paymentMethod: "Bank",
    paymentStatus: "Paid",
    description: "",
    tags: "",
  };
}

/** The form's strings, as the action wants them. */
export function toActionInput(values: EntryValues) {
  return {
    clientId: values.clientId,
    direction: values.direction,
    name: values.name,
    date: values.date,
    bookMonth: values.bookMonth || undefined,
    amount: values.amount,
    currency: values.currency,
    exchangeRate: values.exchangeRate || undefined,
    categoryId: values.categoryId || undefined,
    vendorId: values.vendorId || undefined,
    paymentMethod: values.paymentMethod as "Bank" | "Card" | "UPI" | "Crypto" | "Cash" | "Other",
    paymentStatus: values.paymentStatus as "Paid" | "Pending" | "Overdue",
    description: values.description || undefined,
    tags: values.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}
