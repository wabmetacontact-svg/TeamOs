"use client";

import { CLIENT_STATUSES } from "@/lib/ui-enums";

import { Field, Input, Select, Textarea } from "@/components/ui/input";

export type BrandOption = { id: string; name: string; fieldDefs: unknown };

/** The shape client-side code reads a brand's definitions as. Mirrors
 *  FieldDef in lib/custom-fields, which the server validates against. */
export type ClientFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "multiselect" | "url";
  required?: boolean;
  options?: string[];
  help?: string;
};

export function brandFieldDefs(brand: BrandOption | undefined): ClientFieldDef[] {
  return Array.isArray(brand?.fieldDefs) ? (brand.fieldDefs as ClientFieldDef[]) : [];
}

export type ClientValues = {
  name: string;
  legalName: string;
  brandId: string;
  subTag: string;
  status: string;
  billingCurrency: string;
  startDate: string;
  notes: string;
  customFields: Record<string, string | string[]>;
};

/**
 * The client form's fields, shared by the create dialog and the edit page so
 * the two cannot drift. The custom-field section is driven entirely by the
 * selected brand's definitions — switching brand changes the form, because on
 * the server it changes what is valid.
 */
export function ClientFields({
  brands,
  values,
  onChange,
  errors,
  subTags = {},
}: {
  brands: BrandOption[];
  values: ClientValues;
  onChange: (patch: Partial<ClientValues>) => void;
  errors: Record<string, string[]>;
  /** What each brand already uses, by brand id. Suggestions, not a list to
   *  pick from — a new sub-tag must stay as easy to type as an existing one. */
  subTags?: Record<string, string[]>;
}) {
  const brand = brands.find((b) => b.id === values.brandId);
  const defs = brandFieldDefs(brand);
  const err = (key: string) => errors[key]?.[0];
  const suggestions = subTags[values.brandId] ?? [];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={err("name")} required>
          <Input
            id="name"
            value={values.name}
            onChange={(e) => onChange({ name: e.currentTarget.value })}
            placeholder="Alpha Industries"
            required
            autoFocus
          />
        </Field>

        <Field label="Legal name" htmlFor="legalName" error={err("legalName")} hint="If invoices use a different one">
          <Input
            id="legalName"
            value={values.legalName}
            onChange={(e) => onChange({ legalName: e.currentTarget.value })}
            placeholder="Alpha Industries Pvt Ltd"
          />
        </Field>

        <Field label="Brand" htmlFor="brandId" error={err("brandId")} required>
          <Select
            id="brandId"
            value={values.brandId}
            onChange={(e) => onChange({ brandId: e.currentTarget.value, customFields: {} })}
            required
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Sub-tag"
          htmlFor="subTag"
          error={err("subTag")}
          hint={
            suggestions.length
              ? `${brand?.name} already uses ${suggestions.slice(0, 3).join(", ")}${suggestions.length > 3 ? "…" : ""}`
              : "Free text — Internal, Jay, whatever this brand divides by"
          }
        >
          <Input
            id="subTag"
            list={suggestions.length ? "subtag-suggestions" : undefined}
            value={values.subTag}
            onChange={(e) => onChange({ subTag: e.currentTarget.value })}
            placeholder={suggestions[0] ?? "Internal"}
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <datalist id="subtag-suggestions">
              {suggestions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          )}
        </Field>

        <Field label="Status" htmlFor="status" error={err("status")}>
          <Select id="status" value={values.status} onChange={(e) => onChange({ status: e.currentTarget.value })}>
            {CLIENT_STATUSES.filter((s) => s !== "Archived" || values.status === "Archived").map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Billing currency" htmlFor="billingCurrency" error={err("billingCurrency")}>
          <Input
            id="billingCurrency"
            value={values.billingCurrency}
            onChange={(e) => onChange({ billingCurrency: e.currentTarget.value.toUpperCase().slice(0, 3) })}
            placeholder="INR"
            maxLength={3}
            className="font-mono uppercase"
          />
        </Field>

        <Field label="Start date" htmlFor="startDate" error={err("startDate")}>
          <Input
            id="startDate"
            type="date"
            value={values.startDate}
            onChange={(e) => onChange({ startDate: e.currentTarget.value })}
          />
        </Field>
      </div>

      {defs.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">{brand?.name} fields</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {defs.map((def) => (
              <CustomField
                key={def.key}
                def={def}
                value={values.customFields[def.key] ?? (def.type === "multiselect" ? [] : "")}
                error={err(`customFields.${def.key}`)}
                onChange={(v) => onChange({ customFields: { ...values.customFields, [def.key]: v } })}
              />
            ))}
          </div>
        </div>
      )}

      <Field label="Notes" htmlFor="notes" error={err("notes")}>
        <Textarea
          id="notes"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.currentTarget.value })}
          placeholder="Anything the next person picking this up would want to know."
        />
      </Field>
    </div>
  );
}

function CustomField({
  def,
  value,
  error,
  onChange,
}: {
  def: ClientFieldDef;
  value: string | string[];
  error?: string;
  onChange: (value: string | string[]) => void;
}) {
  const id = `cf-${def.key}`;

  if (def.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <Field label={def.label} error={error} hint={def.help} required={def.required} className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {def.options?.map((option) => {
            const on = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(on ? selected.filter((v) => v !== option) : [...selected, option])}
                className={`rounded-md px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset transition-colors ${
                  on ? "bg-brand-soft text-brand ring-brand/30" : "bg-surface text-muted ring-border hover:text-fg"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }

  return (
    <Field label={def.label} htmlFor={id} error={error} hint={def.help} required={def.required}>
      {def.type === "select" ? (
        <Select id={id} value={String(value)} onChange={(e) => onChange(e.currentTarget.value)}>
          <option value="">Not set</option>
          {def.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          type={def.type === "date" ? "date" : def.type === "number" ? "text" : "text"}
          inputMode={def.type === "number" ? "decimal" : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={def.type === "url" ? "example.com" : undefined}
        />
      )}
    </Field>
  );
}

export function emptyClientValues(brandId: string): ClientValues {
  return {
    name: "",
    legalName: "",
    brandId,
    subTag: "",
    status: "Onboarding",
    billingCurrency: "INR",
    startDate: "",
    notes: "",
    customFields: {},
  };
}
