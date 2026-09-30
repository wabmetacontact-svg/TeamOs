"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateClient } from "../actions";
import { ClientFields, brandFieldDefs, type BrandOption, type ClientValues } from "../client-fields";

type Client = ClientValues & { id: string };

export function ClientEditor({
  client,
  brands,
  canEdit,
  subTags,
}: {
  client: Client;
  brands: BrandOption[];
  canEdit: boolean;
  subTags: Record<string, string[]>;
}) {
  const [values, setValues] = useState<ClientValues>(() => stripId(client));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);

  // Save stays disabled until something actually moved, so the button does not
  // invite a write that would add an empty entry to the history.
  const dirty = JSON.stringify(values) !== JSON.stringify(stripId(client));

  if (!canEdit) return <ReadOnly client={client} brands={brands} />;

  function save() {
    setError(null);
    setErrors({});
    setSaved(false);
    start(async () => {
      const result = await updateClient({
        id: client.id,
        ...values,
        legalName: values.legalName || undefined,
        subTag: values.subTag || undefined,
        notes: values.notes || undefined,
        status: values.status as "Onboarding" | "Active" | "Paused" | "Archived",
      });

      if (result.ok) setSaved(true);
      else {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
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
        onChange={(patch) => {
          setSaved(false);
          setValues((v) => ({ ...v, ...patch }));
        }}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
          Save changes
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="size-4" />
            Saved
          </span>
        )}
        {dirty && !pending && <span className="text-sm text-muted">Unsaved changes</span>}
      </div>
    </form>
  );
}

/** The comparable half of the record: everything the form can change. */
function stripId({ id, ...values }: Client): ClientValues {
  void id;
  return values;
}

function ReadOnly({ client, brands }: { client: Client; brands: BrandOption[] }) {
  const brand = brands.find((b) => b.id === client.brandId);
  const defs = brandFieldDefs(brand);

  const rows: [string, string][] = [
    ["Legal name", client.legalName],
    ["Brand", brand?.name ?? ""],
    ["Sub-tag", client.subTag],
    ["Status", client.status],
    ["Billing currency", client.billingCurrency],
    ["Start date", client.startDate],
    ...defs.map((def): [string, string] => {
      const value = client.customFields[def.key];
      return [def.label, Array.isArray(value) ? value.join(", ") : (value ?? "")];
    }),
  ];

  return (
    <div className="grid gap-2 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-muted">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      {client.notes && <p className="mt-2 whitespace-pre-wrap border-t border-border pt-3 text-muted">{client.notes}</p>}
    </div>
  );
}
