"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createTransaction } from "./actions";
import { EntryFields, emptyEntry, toActionInput, type EntryValues, type Option } from "./entry-fields";

export function NewEntryButton({
  clients,
  categories,
  vendors,
  defaultMonth,
  baseCurrency,
}: {
  clients: Option[];
  categories: Option[];
  vendors: Option[];
  defaultMonth: string;
  baseCurrency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [values, setValues] = useState<EntryValues>(() => emptyEntry(defaultMonth, baseCurrency));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [again, setAgain] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  function submit() {
    setError(null);
    setErrors({});
    setNote(null);
    start(async () => {
      const result = await createTransaction(toActionInput(values));

      if (result.ok) {
        router.refresh();
        if (again) {
          // Entering a month of receipts is a run of similar rows, so the
          // client, category and date stay and only the payee and amount clear.
          setValues({ ...values, name: "", amount: "", description: "", tags: "" });
          setNote(result.message ?? null);
        } else {
          setOpen(false);
          setValues(emptyEntry(defaultMonth, baseCurrency));
        }
      } else {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setValues(emptyEntry(defaultMonth, baseCurrency));
          setError(null);
          setErrors({});
          setNote(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New entry
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New entry"
        className="sm:max-w-2xl"
        footer={
          <>
            <label className="mr-auto flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={again}
                onChange={(e) => setAgain(e.currentTarget.checked)}
                className="size-4 accent-brand"
              />
              Add another after this
            </label>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              Save entry
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-4"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          {note && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{note}</p>}

          <EntryFields
            values={values}
            onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
            errors={errors}
            clients={clients}
            categories={categories}
            vendors={vendors}
            baseCurrency={baseCurrency}
          />

          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
