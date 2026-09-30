"use client";

import { BRAND_COLORS } from "@/lib/ui-enums";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AlertCircle, Check, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { deleteBrand, fieldUsage, renameBrand, updateBrandFields } from "./actions";
import { FieldEditor, type EditableField, type FieldType } from "./field-editor";

type Brand = {
  id: string;
  name: string;
  color: string;
  fieldDefs: { key: string; label: string; type: string; required?: boolean; options?: string[]; help?: string }[];
  clients: number;
  categories: number;
  tasks: number;
};

export function BrandCard({ brand, canEdit }: { brand: Brand; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const [name, setName] = useState(brand.name);
  const [color, setColor] = useState(brand.color);
  const [fields, setFields] = useState<EditableField[]>(() => toEditable(brand.fieldDefs));
  const [usage, setUsage] = useState<Record<string, number>>({});

  // Loaded when the editor opens, not on every page render: it walks every
  // client's JSONB, and the number only matters once you are about to change
  // something.
  useEffect(() => {
    if (!editing) return;
    start(async () => {
      const result = await fieldUsage({ id: brand.id });
      if (result.ok) setUsage(result.data?.counts ?? {});
    });
  }, [editing, brand.id]);

  function save() {
    setError(null);
    setErrors({});
    setSaved(null);
    start(async () => {
      if (name !== brand.name || color !== brand.color) {
        const renamed = await renameBrand({ id: brand.id, name, color: color as (typeof BRAND_COLORS)[number] });
        if (!renamed.ok) {
          setError(renamed.error);
          return;
        }
      }

      const result = await updateBrandFields({
        id: brand.id,
        fieldDefs: fields.map(({ existing, options, help, ...rest }) => {
          void existing;
          return {
            ...rest,
            ...(options?.length ? { options } : {}),
            ...(help ? { help } : {}),
          };
        }),
      });

      if (result.ok) {
        setSaved(result.message ?? "Saved.");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${dot(brand.color)}`} aria-hidden />
            {brand.name}
          </span>
        }
        description={`${brand.clients} ${brand.clients === 1 ? "client" : "clients"} · ${brand.fieldDefs.length} extra ${brand.fieldDefs.length === 1 ? "field" : "fields"}`}
        action={
          canEdit && (
            <Button
              size="sm"
              variant={editing ? "ghost" : "secondary"}
              onClick={() => {
                setEditing(!editing);
                setError(null);
                setSaved(null);
                if (editing) {
                  setName(brand.name);
                  setColor(brand.color);
                  setFields(toEditable(brand.fieldDefs));
                }
              }}
            >
              <Settings2 />
              {editing ? "Cancel" : "Edit"}
            </Button>
          )
        }
      />

      <CardBody className="grid gap-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        {saved && !editing && (
          <p className="flex items-start gap-1.5 text-sm text-emerald-600">
            <Check className="mt-0.5 size-4 shrink-0" />
            {saved}
          </p>
        )}

        {!editing ? (
          brand.fieldDefs.length === 0 ? (
            <p className="text-sm text-muted">
              Clients under {brand.name} get the standard form. Add fields if this brand tracks something the others do
              not.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {brand.fieldDefs.map((def) => (
                <Badge key={def.key} tone={def.required ? "blue" : "grey"}>
                  {def.label}
                  <span className="opacity-60">· {def.type}</span>
                </Badge>
              ))}
            </div>
          )
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="Name" htmlFor={`name-${brand.id}`} required>
                <Input id={`name-${brand.id}`} value={name} onChange={(e) => setName(e.currentTarget.value)} />
              </Field>
              <Field label="Colour" htmlFor={`color-${brand.id}`}>
                <Select id={`color-${brand.id}`} value={color} onChange={(e) => setColor(e.currentTarget.value)}>
                  {BRAND_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Client fields</p>
              <FieldEditor
                fields={fields}
                onChange={setFields}
                usage={usage}
                clientCount={brand.clients}
                errors={errors}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button variant="primary" loading={pending} onClick={save}>
                Save {brand.name}
              </Button>

              {brand.clients === 0 && (
                <Button
                  variant="ghost"
                  loading={pending}
                  className="ml-auto text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
                  onClick={() =>
                    start(async () => {
                      const result = await deleteBrand({ id: brand.id });
                      if (!result.ok) setError(result.error);
                      else router.refresh();
                    })
                  }
                >
                  <Trash2 />
                  Delete brand
                </Button>
              )}
              {brand.clients > 0 && (
                <span className="ml-auto text-xs text-muted">
                  Cannot be deleted while {brand.clients} {brand.clients === 1 ? "client sits" : "clients sit"} under it
                </span>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function toEditable(defs: Brand["fieldDefs"]): EditableField[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    type: def.type as FieldType,
    required: def.required ?? false,
    options: def.options,
    help: def.help,
    existing: true,
  }));
}

function dot(color: string): string {
  return (
    {
      blue: "bg-blue-500",
      green: "bg-emerald-500",
      orange: "bg-orange-500",
      red: "bg-rose-500",
      purple: "bg-violet-500",
      slate: "bg-slate-400",
    }[color] ?? "bg-slate-400"
  );
}
