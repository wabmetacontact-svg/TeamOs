"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { updatePerson } from "../../pipelines/actions";

type Person = { id: string; name: string; email: string; phone: string; notes: string };

export function PersonEditor({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);

  if (!canEdit) {
    return (
      <div className="grid gap-2 text-sm">
        {person.email && <Row label="Email" value={person.email} />}
        {person.phone && <Row label="Phone" value={person.phone} />}
        {person.notes && <p className="mt-1 whitespace-pre-wrap text-muted">{person.notes}</p>}
        {!person.email && !person.phone && !person.notes && <p className="text-muted">Nothing recorded yet.</p>}
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        start(async () => {
          setError(null);
          setErrors({});
          setSaved(false);
          const result = await updatePerson({
            id: person.id,
            name: String(formData.get("name") ?? ""),
            email: String(formData.get("email") ?? "") || undefined,
            phone: String(formData.get("phone") ?? "") || undefined,
            notes: String(formData.get("notes") ?? "") || undefined,
          });
          if (result.ok) {
            setSaved(true);
            router.refresh();
          } else {
            setError(result.error);
            setErrors(result.fieldErrors ?? {});
          }
        })
      }
      className="grid gap-3"
    >
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <Field label="Name" htmlFor="p-name" error={errors.name?.[0]} required>
        <Input id="p-name" name="name" defaultValue={person.name} required />
      </Field>

      <Field
        label="Email"
        htmlFor="p-email"
        error={errors.email?.[0]}
        hint="One address per person across the whole workspace"
      >
        <Input id="p-email" name="email" type="email" defaultValue={person.email} />
      </Field>

      <Field label="Phone" htmlFor="p-phone" error={errors.phone?.[0]}>
        <Input id="p-phone" name="phone" defaultValue={person.phone} />
      </Field>

      <Field label="About them" htmlFor="p-notes" hint="Shared across every pipeline they appear in">
        <Textarea id="p-notes" name="notes" defaultValue={person.notes} />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="primary" loading={pending}>
          Save
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="size-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}
