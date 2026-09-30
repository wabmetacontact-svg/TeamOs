"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "./actions";
import { ClientFields, emptyClientValues, type BrandOption, type ClientValues } from "./client-fields";

export function NewClientButton({ brands, subTags }: { brands: BrandOption[]; subTags: Record<string, string[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [values, setValues] = useState<ClientValues>(() => emptyClientValues(brands[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function submit() {
    setError(null);
    setErrors({});
    start(async () => {
      const result = await createClient({
        ...values,
        legalName: values.legalName || undefined,
        subTag: values.subTag || undefined,
        notes: values.notes || undefined,
        status: values.status as "Onboarding" | "Active" | "Paused" | "Archived",
      });

      if (result.ok) {
        setOpen(false);
        setValues(emptyClientValues(brands[0]?.id ?? ""));
        // Straight to the client that was just made — the next thing anyone
        // does is add its contacts or assign someone to it.
        if (result.data?.id) router.push(`/clients/${result.data.id}`);
      } else {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
      }
    });
  }

  if (brands.length === 0) {
    return (
      <Button variant="primary" disabled title="Add a brand first">
        <Plus />
        New client
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New client
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New client"
        description="The brand decides which extra fields appear below it."
        className="sm:max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              Add client
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

          <ClientFields
            brands={brands}
            subTags={subTags}
            values={values}
            errors={errors}
            onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          />

          {/* Enter submits, which the footer button outside the form would not do. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
