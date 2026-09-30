"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { formatMoney, toInput } from "@/lib/money";
import { createRecurring, deleteRecurring, runRecurring, updateRecurring } from "./actions";

type Rule = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  categoryId: string | null;
  categoryName: string | null;
  direction: "IN" | "OUT";
  amount: string;
  currency: string;
  dayOfMonth: number;
  nextRunAt: string;
  active: boolean;
};

type Option = { id: string; name: string; direction?: string };

export function RecurringList({
  rules,
  clients,
  categories,
  baseCurrency,
  canEdit,
  monthlyTotal,
  startOpen = false,
}: {
  rules: Rule[];
  clients: Option[];
  categories: Option[];
  baseCurrency: string;
  canEdit: boolean;
  monthlyTotal: string;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(startOpen);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; why: string }[]>([]);

  const active = rules.filter((r) => r.active);
  const due = active.filter((r) => new Date(r.nextRunAt) <= new Date()).length;

  return (
    <div className="grid gap-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {note && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <p>{note}</p>
          {skipped.length > 0 && (
            <ul className="mt-1 text-xs text-emerald-800">
              {skipped.map((s) => (
                <li key={s.name}>
                  {s.name} — {s.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rules.length > 0 && (
        <Card>
          <CardHeader
            title={`${active.length} active`}
            description={`${formatMoney(BigInt(monthlyTotal), baseCurrency)} of spend a month, if every rule fires`}
            action={
              canEdit && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={due > 0 ? "primary" : "secondary"}
                    loading={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null);
                        setNote(null);
                        const result = await runRecurring({});
                        if (result.ok) {
                          setNote(result.message ?? null);
                          setSkipped(result.data?.skipped ?? []);
                          router.refresh();
                        } else setError(result.error);
                      })
                    }
                  >
                    <Play />
                    {due > 0 ? `Generate ${due} due` : "Generate due"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAdding(!adding)}>
                    <Plus />
                    Add
                  </Button>
                </div>
              )
            }
          />

          <div className="divide-y divide-border">
            {rules.map((rule) => {
              const isDue = new Date(rule.nextRunAt) <= new Date();
              return (
                <div key={rule.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm font-medium ${rule.active ? "" : "text-muted"}`}>
                          {rule.name}
                        </span>
                        {!rule.active && <Badge tone="grey">Paused</Badge>}
                        {rule.active && isDue && <Badge tone="orange">Due</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted">
                        {rule.clientName}
                        {rule.categoryName && ` · ${rule.categoryName}`} · day {rule.dayOfMonth} · next{" "}
                        {new Date(rule.nextRunAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>

                    <span className={`text-sm font-medium tabular-nums ${rule.direction === "IN" ? "text-emerald-600" : ""}`}>
                      {rule.direction === "IN" ? "+" : "−"}
                      {formatMoney(BigInt(rule.amount), rule.currency).replace("−", "")}
                    </span>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setEditing(editing === rule.id ? null : rule.id)}
                        className="text-[13px] font-medium text-brand hover:underline"
                      >
                        {editing === rule.id ? "Close" : "Edit"}
                      </button>
                    )}
                  </div>

                  {editing === rule.id && canEdit && (
                    <RuleForm
                      rule={rule}
                      clients={clients}
                      categories={categories}
                      pending={pending}
                      onCancel={() => setEditing(null)}
                      onDelete={() =>
                        start(async () => {
                          setError(null);
                          const result = await deleteRecurring({ id: rule.id });
                          if (result.ok) {
                            setEditing(null);
                            router.refresh();
                          } else setError(result.error);
                        })
                      }
                      onSubmit={(values) =>
                        start(async () => {
                          setError(null);
                          const result = await updateRecurring({ id: rule.id, ...values });
                          if (result.ok) {
                            setEditing(null);
                            router.refresh();
                          } else setError(result.error);
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {adding && canEdit && (
        <Card>
          <CardHeader title="New rule" description="It produces a draft on its day, never an approved entry." />
          <CardBody>
            <RuleForm
              clients={clients}
              categories={categories}
              pending={pending}
              onCancel={() => setAdding(false)}
              onSubmit={(values) =>
                start(async () => {
                  setError(null);
                  const result = await createRecurring(values);
                  if (result.ok) {
                    setAdding(false);
                    router.refresh();
                  } else setError(result.error);
                })
              }
            />
          </CardBody>
        </Card>
      )}

      {!adding && canEdit && rules.length === 0 && (
        <Button variant="primary" className="justify-self-start" onClick={() => setAdding(true)}>
          <Plus />
          Add a rule
        </Button>
      )}
    </div>
  );
}

type FormValues = {
  clientId: string;
  name: string;
  amount: string;
  currency: string;
  direction: "IN" | "OUT";
  categoryId?: string;
  dayOfMonth: number;
  active: boolean;
};

function RuleForm({
  rule,
  clients,
  categories,
  pending,
  onSubmit,
  onCancel,
  onDelete,
}: {
  rule?: Rule;
  clients: Option[];
  categories: Option[];
  pending: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [direction, setDirection] = useState<"IN" | "OUT">(rule?.direction ?? "OUT");

  return (
    <form
      action={(formData) =>
        onSubmit({
          clientId: String(formData.get("clientId") ?? ""),
          name: String(formData.get("name") ?? ""),
          amount: String(formData.get("amount") ?? ""),
          currency: String(formData.get("currency") ?? "INR"),
          direction,
          categoryId: String(formData.get("categoryId") ?? "") || undefined,
          dayOfMonth: Number(formData.get("dayOfMonth") ?? 1),
          active: formData.get("active") === "on",
        })
      }
      className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <Field label="What is it" htmlFor={`r-name-${rule?.id ?? "new"}`} required>
        <Input id={`r-name-${rule?.id ?? "new"}`} name="name" defaultValue={rule?.name} placeholder="Adobe CC" required />
      </Field>

      <Field label="Client" htmlFor={`r-client-${rule?.id ?? "new"}`} required>
        <Select id={`r-client-${rule?.id ?? "new"}`} name="clientId" defaultValue={rule?.clientId ?? ""} required>
          <option value="">Choose…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Amount" htmlFor={`r-amount-${rule?.id ?? "new"}`} required>
        <div className="flex gap-2">
          <Input
            id={`r-amount-${rule?.id ?? "new"}`}
            name="amount"
            defaultValue={rule ? toInput(BigInt(rule.amount), rule.currency) : ""}
            inputMode="decimal"
            placeholder="4,230"
            className="flex-1 tabular-nums"
            required
          />
          <Input
            name="currency"
            defaultValue={rule?.currency ?? "INR"}
            maxLength={3}
            aria-label="Currency"
            className="w-20 font-mono uppercase"
          />
        </div>
      </Field>

      <Field
        label="Day of the month"
        htmlFor={`r-day-${rule?.id ?? "new"}`}
        hint="1 to 28, so every month has one"
        required
      >
        <Input
          id={`r-day-${rule?.id ?? "new"}`}
          name="dayOfMonth"
          type="number"
          min={1}
          max={28}
          defaultValue={rule?.dayOfMonth ?? 1}
          required
        />
      </Field>

      <Field label="Direction" htmlFor={`r-dir-${rule?.id ?? "new"}`}>
        <Select
          id={`r-dir-${rule?.id ?? "new"}`}
          value={direction}
          onChange={(e) => setDirection(e.currentTarget.value as "IN" | "OUT")}
        >
          <option value="OUT">Money out</option>
          <option value="IN">Money in</option>
        </Select>
      </Field>

      <Field label="Category" htmlFor={`r-cat-${rule?.id ?? "new"}`}>
        <Select id={`r-cat-${rule?.id ?? "new"}`} name="categoryId" defaultValue={rule?.categoryId ?? ""}>
          <option value="">Uncategorised</option>
          {categories
            .filter((c) => c.direction === direction)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
      </Field>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} className="size-4 accent-[var(--brand)]" />
        Active — generates a draft each month
      </label>

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="primary" loading={pending}>
          {rule ? "Save" : "Add rule"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onDelete && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={onDelete}
            className="ml-auto text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
          >
            <Trash2 />
            Delete rule
          </Button>
        )}
      </div>
    </form>
  );
}
