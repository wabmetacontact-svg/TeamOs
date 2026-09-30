"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createRelationship, moveStage, updateRelationship } from "../../pipelines/actions";

type Stage = { id: string; name: string };
type Relationship = {
  id: string;
  contextId: string;
  contextName: string;
  stageId: string | null;
  stageName: string | null;
  isTerminal: boolean;
  ownerName: string | null;
  clientName: string | null;
  value: string | null;
  currency: string;
  notes: string | null;
  stages: Stage[];
};

export function RelationshipPanel({
  personId,
  relationships,
  available,
  owners,
  canEdit,
  canCreate,
}: {
  personId: string;
  relationships: Relationship[];
  available: { id: string; name: string; stages: Stage[] }[];
  owners: { id: string; name: string }[];
  canEdit: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newContext, setNewContext] = useState(available[0]?.id ?? "");

  return (
    <div className="grid gap-3">
      {relationships.length === 0 && !adding && (
        <p className="text-sm text-muted">
          No relationship you can see. Adding one puts them in a pipeline and gives them an owner.
        </p>
      )}

      {relationships.map((rel) => (
        <div key={rel.id} className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{rel.contextName}</Badge>
            {rel.stageName && <Badge tone={rel.isTerminal ? "grey" : "green"}>{rel.stageName}</Badge>}
            {rel.value && (
              <Badge tone="green">
                {rel.currency} {(Number(rel.value) / 100).toLocaleString("en-IN")}
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted">{rel.ownerName ?? "Unowned"}</span>
          </div>

          {rel.clientName && <p className="mt-1.5 text-xs text-muted">Under {rel.clientName}</p>}
          {rel.notes && <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{rel.notes}</p>}

          {canEdit && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {rel.stages.length > 1 && (
                <Select
                  aria-label={`Stage in ${rel.contextName}`}
                  value={rel.stageId ?? ""}
                  disabled={pending}
                  onChange={(e) =>
                    start(async () => {
                      setError(null);
                      const result = await moveStage({ id: rel.id, stageId: e.currentTarget.value });
                      if (result.ok) router.refresh();
                      else setError(result.error);
                    })
                  }
                  className="h-8 w-40 text-[13px]"
                >
                  {rel.stageId === null && <option value="">Not placed</option>}
                  {rel.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}

              <button
                type="button"
                onClick={() => setEditing(editing === rel.id ? null : rel.id)}
                className="text-[13px] font-medium text-brand hover:underline"
              >
                {editing === rel.id ? "Close" : "Edit"}
              </button>
            </div>
          )}

          {editing === rel.id && (
            <form
              action={(formData) =>
                start(async () => {
                  setError(null);
                  const result = await updateRelationship({
                    id: rel.id,
                    ownerId: String(formData.get("ownerId") ?? "") || undefined,
                    value: String(formData.get("value") ?? "") || undefined,
                    currency: String(formData.get("currency") ?? "") || undefined,
                    notes: String(formData.get("notes") ?? "") || undefined,
                  });
                  if (result.ok) {
                    setEditing(null);
                    router.refresh();
                  } else setError(result.error);
                })
              }
              className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
            >
              <Field label="Owner" htmlFor={`owner-${rel.id}`}>
                <Select id={`owner-${rel.id}`} name="ownerId" defaultValue={owners.find((o) => o.name === rel.ownerName)?.id ?? ""}>
                  <option value="">Unowned</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Value" htmlFor={`value-${rel.id}`}>
                <Input
                  id={`value-${rel.id}`}
                  name="value"
                  inputMode="decimal"
                  defaultValue={rel.value ? String(Number(rel.value) / 100) : ""}
                  placeholder="50,00,000"
                />
              </Field>

              <input type="hidden" name="currency" value={rel.currency} />

              <Field label="Notes" htmlFor={`notes-${rel.id}`} className="sm:col-span-2">
                <Textarea id={`notes-${rel.id}`} name="notes" defaultValue={rel.notes ?? ""} />
              </Field>

              <Button type="submit" size="sm" variant="primary" loading={pending} className="justify-self-start">
                Save
              </Button>
            </form>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      {canCreate &&
        available.length > 0 &&
        (adding ? (
          <form
            action={(formData) =>
              start(async () => {
                setError(null);
                const result = await createRelationship({
                  personId,
                  // The person exists; these are required by the schema but
                  // ignored when personId resolves.
                  name: "—",
                  contextId: String(formData.get("contextId") ?? ""),
                  stageId: String(formData.get("stageId") ?? "") || undefined,
                  ownerId: String(formData.get("ownerId") ?? "") || undefined,
                  value: String(formData.get("value") ?? "") || undefined,
                  currency: "INR",
                  relationshipNotes: String(formData.get("notes") ?? "") || undefined,
                });
                if (result.ok) {
                  setAdding(false);
                  router.refresh();
                } else setError(result.error);
              })
            }
            className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-2"
          >
            <Field label="Pipeline" htmlFor="new-context" required>
              <Select
                id="new-context"
                name="contextId"
                value={newContext}
                onChange={(e) => setNewContext(e.currentTarget.value)}
                required
              >
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Stage" htmlFor="new-stage">
              <Select id="new-stage" name="stageId" defaultValue="" key={newContext}>
                <option value="">First stage</option>
                {available.find((c) => c.id === newContext)?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Owner" htmlFor="new-owner" hint="Defaults to you">
              <Select id="new-owner" name="ownerId" defaultValue="">
                <option value="">You</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Value" htmlFor="new-value">
              <Input id="new-value" name="value" inputMode="decimal" placeholder="50,00,000" />
            </Field>

            <Field label="Notes" htmlFor="new-notes" className="sm:col-span-2">
              <Textarea id="new-notes" name="notes" placeholder="Where this came from, what they want." />
            </Field>

            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" variant="primary" loading={pending}>
                Add relationship
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setAdding(true)}>
            <Plus />
            Add to another pipeline
          </Button>
        ))}

      {canCreate && available.length === 0 && relationships.length > 0 && (
        <p className="text-xs text-muted">
          They are already in every pipeline you can see. One person holds one relationship per pipeline.
        </p>
      )}
    </div>
  );
}
