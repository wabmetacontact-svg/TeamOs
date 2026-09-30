import "server-only";
import { z } from "zod";

/**
 * Typed custom fields.
 *
 * Every brand runs differently enough that a fixed client form would be wrong
 * for all of them — ARC3 tracks a contract end date, LineUp tracks a platform,
 * Hypergravity tracks neither. So a brand carries its own field definitions and
 * a client carries the values.
 *
 * JSONB is the storage, but it is not the contract. Values are validated
 * against the brand's definitions on the way in, which is the difference
 * between "flexible" and "whatever happened to be posted". A field the brand
 * does not define is dropped rather than stored, because a column nobody can
 * see is a column nobody can fix.
 */

export const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldDefSchema = z
  .object({
    /** Stable across renames: the value map is keyed on this, never on label. */
    key: z
      .string()
      .trim()
      .min(1, "A field needs a key")
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores"),
    label: z.string().trim().min(1, "A field needs a label").max(60),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    /** select and multiselect only. */
    options: z.array(z.string().trim().min(1)).max(40).optional(),
    help: z.string().trim().max(160).optional(),
  })
  .refine((def) => !["select", "multiselect"].includes(def.type) || (def.options?.length ?? 0) > 0, {
    path: ["options"],
    message: "A choice field needs at least one option",
  });

export type FieldDef = z.infer<typeof fieldDefSchema>;

export const fieldDefsSchema = z
  .array(fieldDefSchema)
  .max(25, "Twenty-five fields is already more than anyone will fill in")
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    for (const [i, def] of defs.entries()) {
      if (seen.has(def.key)) {
        ctx.addIssue({ code: "custom", path: [i, "key"], message: `Two fields both use the key "${def.key}"` });
      }
      seen.add(def.key);
    }
  });

/** Reads a brand's stored definitions, tolerating anything malformed. */
export function readFieldDefs(raw: unknown): FieldDef[] {
  const parsed = fieldDefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export type CustomFieldValues = Record<string, string | number | string[] | null>;

/**
 * Validates one client's values against its brand's definitions.
 *
 * Returns the cleaned map and any per-field messages, rather than throwing, so
 * a form can show every problem at once instead of one per submission.
 */
export function validateCustomFields(
  defs: FieldDef[],
  input: Record<string, unknown>,
): { values: CustomFieldValues; errors: Record<string, string[]> } {
  const values: CustomFieldValues = {};
  const errors: Record<string, string[]> = {};
  const fail = (key: string, message: string) => {
    (errors[`customFields.${key}`] ??= []).push(message);
  };

  for (const def of defs) {
    const raw = input[def.key];
    const empty = raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0);

    if (empty) {
      if (def.required) fail(def.key, `${def.label} is required`);
      // Stored as null rather than omitted, so "never filled in" and "cleared"
      // read the same in the history.
      values[def.key] = null;
      continue;
    }

    switch (def.type) {
      case "text": {
        const text = String(raw).trim();
        if (text.length > 500) fail(def.key, `${def.label} is too long`);
        else values[def.key] = text;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
        if (!Number.isFinite(n)) fail(def.key, `${def.label} must be a number`);
        else values[def.key] = n;
        break;
      }
      case "date": {
        const text = String(raw).trim();
        // Stored as yyyy-MM-dd, not a Date: a contract end date has no time and
        // no timezone, and giving it one invents a difference that is not there.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
          fail(def.key, `${def.label} must be a date`);
        } else values[def.key] = text;
        break;
      }
      case "url": {
        const text = String(raw).trim();
        try {
          const url = new URL(text.includes("://") ? text : `https://${text}`);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("scheme");
          values[def.key] = url.toString();
        } catch {
          fail(def.key, `${def.label} must be a web address`);
        }
        break;
      }
      case "select": {
        const text = String(raw).trim();
        if (!def.options?.includes(text)) fail(def.key, `${def.label} must be one of the listed choices`);
        else values[def.key] = text;
        break;
      }
      case "multiselect": {
        const list = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
        const unknown = list.filter((v) => !def.options?.includes(v));
        if (unknown.length) fail(def.key, `${def.label}: ${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not a choice`);
        else values[def.key] = [...new Set(list)];
        break;
      }
    }
  }

  return { values, errors };
}

/** Reads stored values back, dropping anything the brand no longer defines. */
export function readCustomFields(defs: FieldDef[], raw: unknown): CustomFieldValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stored = raw as Record<string, unknown>;
  const values: CustomFieldValues = {};
  for (const def of defs) {
    const v = stored[def.key];
    values[def.key] = v === undefined ? null : (v as CustomFieldValues[string]);
  }
  return values;
}

/** For display and for CSV: one value as a person would read it. */
export function formatFieldValue(def: FieldDef, value: CustomFieldValues[string]): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (def.type === "date") {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return String(value);
}
