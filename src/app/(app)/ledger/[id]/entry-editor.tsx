"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { deleteTransaction, updateTransaction } from "../actions";
import { EntryFields, toActionInput, type EntryValues, type Option } from "../entry-fields";

type Transaction = EntryValues & { id: string; approvalState: string };

export function EntryEditor({
  transaction,
  clients,
  categories,
  vendors,
  baseCurrency,
  canEdit,
  canDelete,
}: {
  transaction: Transaction;
  clients: Option[];
  categories: Option[];
  vendors: Option[];
  baseCurrency: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EntryValues>(() => strip(transaction));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dirty = JSON.stringify(values) !== JSON.stringify(strip(transaction));
  const wasApproved = transaction.approvalState === "Approved";

  if (!canEdit) return <ReadOnly values={strip(transaction)} categories={categories} clients={clients} baseCurrency={baseCurrency} />;

  return (
    <div className="grid gap-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {wasApproved && dirty && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          This was approved. Changing the amount or the book month sends it back to the queue — an approval that refers
          to figures nobody approved is not an approval.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setErrors({});
          setSaved(null);
          start(async () => {
            const result = await updateTransaction({ id: transaction.id, ...toActionInput(values) });
            if (result.ok) {
              setSaved(result.message ?? "Saved.");
              router.refresh();
            } else {
              setError(result.error);
              setErrors(result.fieldErrors ?? {});
            }
          });
        }}
        className="grid gap-4"
      >
        <EntryFields
          values={values}
          onChange={(patch) => {
            setSaved(null);
            setValues((v) => ({ ...v, ...patch }));
          }}
          errors={errors}
          clients={clients}
          categories={categories}
          vendors={vendors}
          baseCurrency={baseCurrency}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
            Save changes
          </Button>
          {saved && !dirty && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="size-4" />
              {saved}
            </span>
          )}
          {dirty && !pending && <span className="text-sm text-muted">Unsaved changes</span>}

          {canDelete &&
            (confirming ? (
              <form
                action={(formData) =>
                  start(async () => {
                    setError(null);
                    const result = await deleteTransaction({
                      id: transaction.id,
                      reason: String(formData.get("reason") ?? "") || undefined,
                    });
                    if (result.ok) router.push("/ledger");
                    else setError(result.error);
                  })
                }
                className="ml-auto flex flex-wrap items-end gap-2"
              >
                {wasApproved && (
                  <Field label="Why is it going?" htmlFor="del-reason" className="min-w-44">
                    <Input id="del-reason" name="reason" required autoFocus placeholder="Duplicate of TX-…" className="h-8 text-[13px]" />
                  </Field>
                )}
                <Button type="submit" size="sm" variant="danger" loading={pending}>
                  Remove
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </form>
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

function strip({ id, approvalState, ...values }: Transaction): EntryValues {
  void id;
  void approvalState;
  return values;
}

function ReadOnly({
  values,
  clients,
  categories,
}: {
  values: EntryValues;
  clients: Option[];
  categories: Option[];
  baseCurrency: string;
}) {
  const category = categories.find((c) => c.id === values.categoryId);

  const rows: [string, string][] = [
    ["Client", clients.find((c) => c.id === values.clientId)?.name ?? ""],
    ["Date", values.date],
    ["Category", category ? (category.parent ? `${category.parent.name} · ${category.name}` : category.name) : ""],
    ["Method", values.paymentMethod],
    ["Status", values.paymentStatus],
    ["Tags", values.tags],
  ];

  return (
    <div className="grid gap-2 text-sm">
      {rows
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-muted">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      {values.description && (
        <p className="mt-2 whitespace-pre-wrap border-t border-border pt-3 text-muted">{values.description}</p>
      )}
    </div>
  );
}
