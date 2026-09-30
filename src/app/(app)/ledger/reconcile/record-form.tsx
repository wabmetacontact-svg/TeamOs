"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { recordExpectation } from "./actions";

export function RecordForm({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<string | null>(null);

  const lastMonth = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  return (
    <form
      action={(formData) =>
        start(async () => {
          setError(null);
          setErrors({});
          setNote(null);
          const result = await recordExpectation({
            clientId: String(formData.get("clientId") ?? ""),
            month: String(formData.get("month") ?? ""),
            expectedIncome: String(formData.get("expectedIncome") ?? ""),
            expectedSpend: String(formData.get("expectedSpend") ?? ""),
            source: String(formData.get("source") ?? "") || undefined,
          });
          if (result.ok) {
            setNote(result.message ?? null);
            router.refresh();
          } else {
            setError(result.error);
            setErrors(result.fieldErrors ?? {});
          }
        })
      }
      className="grid gap-3"
    >
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
      {note && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600">
          <Check className="size-4" />
          {note}
        </p>
      )}

      <Field label="Client" htmlFor="r-client" required>
        <Select id="r-client" name="clientId" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Month" htmlFor="r-month" required>
        <Input id="r-month" name="month" type="month" defaultValue={lastMonth} required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Sheet says: in" htmlFor="r-in" error={errors.expectedIncome?.[0]}>
          <Input id="r-in" name="expectedIncome" inputMode="decimal" placeholder="2,50,000" className="tabular-nums" />
        </Field>
        <Field label="Sheet says: out" htmlFor="r-out" error={errors.expectedSpend?.[0]}>
          <Input id="r-out" name="expectedSpend" inputMode="decimal" placeholder="57,999" className="tabular-nums" />
        </Field>
      </div>

      <Field label="Source" htmlFor="r-source" hint="The file and tab, so the next person can find it">
        <Input id="r-source" name="source" placeholder="MonthBook 2026.xlsx · March" />
      </Field>

      <Button type="submit" variant="primary" loading={pending} className="justify-self-start">
        Record
      </Button>

      <p className="text-xs text-muted">
        Recording a new figure for a month already settled reopens it — a month signed off against a number that has
        since changed is not a month anybody signed off.
      </p>
    </form>
  );
}
