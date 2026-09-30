"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

export const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type EditableField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  help?: string;
  /** False for a row added in this session — its key is still editable. */
  existing: boolean;
};

const TYPE_HELP: Record<FieldType, string> = {
  text: "A line of text",
  number: "A number, stored as a number",
  date: "A day, with no time and no timezone",
  select: "One of a fixed list",
  multiselect: "Any number from a fixed list",
  url: "A web address",
};

/**
 * The field-definition editor.
 *
 * Two things are deliberately locked once a field exists: its key and its
 * type. The key is what every client's stored values are keyed on, so renaming
 * it would orphan them all without a single error. The type decides the shape
 * of those values, so changing it would make every client fail validation on
 * its next save. Both are refused on the server too — this only explains why.
 */
export function FieldEditor({
  fields,
  onChange,
  usage,
  clientCount,
  errors,
}: {
  fields: EditableField[];
  onChange: (fields: EditableField[]) => void;
  usage: Record<string, number>;
  clientCount: number;
  errors: Record<string, string[]>;
}) {
  const [open, setOpen] = useState<number | null>(null);

  function patch(index: number, changes: Partial<EditableField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...changes } : f)));
  }

  function move(index: number, by: number) {
    const next = [...fields];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function add() {
    onChange([...fields, { key: "", label: "", type: "text", required: false, existing: false }]);
    setOpen(fields.length);
  }

  return (
    <div className="grid gap-2">
      {fields.length === 0 && (
        <p className="text-sm text-muted">
          No extra fields. Clients under this brand get the standard form and nothing more.
        </p>
      )}

      {fields.map((field, index) => {
        const used = usage[field.key] ?? 0;
        const expanded = open === index;
        const fieldErrors = Object.entries(errors)
          .filter(([key]) => key.startsWith(`${index}.`))
          .flatMap(([, messages]) => messages);

        return (
          <div
            key={`${field.key}-${index}`}
            className={`rounded-lg border bg-surface-2 ${fieldErrors.length ? "border-rose-300" : "border-border"}`}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : index)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-sm font-medium">{field.label || "Untitled field"}</span>
                <span className="ml-2 text-xs text-muted">{field.type}</span>
                {field.required && <span className="ml-1.5 text-xs text-[var(--red)]">required</span>}
              </button>

              {used > 0 && (
                <Badge tone="grey">
                  {used} of {clientCount}
                </Badge>
              )}

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded p-1 text-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === fields.length - 1}
                  className="rounded p-1 text-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(fields.filter((_, i) => i !== index))}
                  className="rounded p-1 text-muted hover:bg-rose-50 hover:text-[var(--red)]"
                  aria-label={`Remove ${field.label || "field"}`}
                  title={
                    used > 0
                      ? `${used} ${used === 1 ? "client has" : "clients have"} a value here. Removing hides it from the form, and the value is dropped the next time that client is saved.`
                      : "Nothing uses this yet"
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            {expanded && (
              <div className="grid gap-3 border-t border-border px-3 py-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Label" htmlFor={`label-${index}`} required>
                    <Input
                      id={`label-${index}`}
                      value={field.label}
                      onChange={(e) => {
                        const label = e.currentTarget.value;
                        // The key follows the label until the field exists, then
                        // it stops — see the comment at the top of this file.
                        patch(index, field.existing ? { label } : { label, key: slug(label) });
                      }}
                      placeholder="Contract ends"
                    />
                  </Field>

                  <Field
                    label="Type"
                    htmlFor={`type-${index}`}
                    hint={field.existing ? "Locked — changing it would break stored values" : TYPE_HELP[field.type]}
                  >
                    <Select
                      id={`type-${index}`}
                      value={field.type}
                      disabled={field.existing}
                      onChange={(e) =>
                        patch(index, {
                          type: e.currentTarget.value as FieldType,
                          options: ["select", "multiselect"].includes(e.currentTarget.value) ? (field.options ?? []) : undefined,
                        })
                      }
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {["select", "multiselect"].includes(field.type) && (
                  <Field
                    label="Choices"
                    htmlFor={`options-${index}`}
                    hint="One per line. Removing a choice does not clear it from clients that already have it."
                  >
                    <textarea
                      id={`options-${index}`}
                      value={(field.options ?? []).join("\n")}
                      onChange={(e) =>
                        patch(index, { options: e.currentTarget.value.split("\n").map((s) => s.trim()).filter(Boolean) })
                      }
                      rows={Math.max(3, (field.options?.length ?? 0) + 1)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                      placeholder={"Gold\nSilver"}
                    />
                  </Field>
                )}

                <Field label="Help text" htmlFor={`help-${index}`} hint="Shown under the field on the client form">
                  <Input
                    id={`help-${index}`}
                    value={field.help ?? ""}
                    onChange={(e) => patch(index, { help: e.currentTarget.value })}
                    placeholder="Optional"
                  />
                </Field>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => patch(index, { required: e.currentTarget.checked })}
                      className="size-4 accent-brand"
                    />
                    Required
                    {field.required && used < clientCount && clientCount > 0 && (
                      <span className="text-xs text-orange-600">
                        — {clientCount - used} existing {clientCount - used === 1 ? "client has" : "clients have"} no
                        value and will need one on their next save
                      </span>
                    )}
                  </label>

                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-subtle">
                    {field.key || "key"}
                    {field.existing && " · locked"}
                  </code>
                </div>

                {fieldErrors.map((message) => (
                  <p key={message} className="text-xs text-[var(--red)]">
                    {message}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={add}>
        <Plus />
        Add field
      </Button>
    </div>
  );
}

/** label → key. Only ever runs before a field exists. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f$1")
    .slice(0, 40);
}
