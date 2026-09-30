"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { deleteContext, renameContext, updateContextStages } from "./actions";

type Stage = { id?: string; name: string; isTerminal: boolean; count: number };
type Context = { id: string; name: string; relationships: number; stages: Stage[] };

export function ContextCard({ context, canEdit }: { context: Context; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(context.name);
  const [stages, setStages] = useState<Stage[]>(context.stages);

  function patch(index: number, changes: Partial<Stage>) {
    setStages(stages.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  }

  function move(index: number, by: number) {
    const next = [...stages];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setStages(next);
  }

  function save() {
    setError(null);
    start(async () => {
      if (name !== context.name) {
        const renamed = await renameContext({ id: context.id, name });
        if (!renamed.ok) {
          setError(renamed.error);
          return;
        }
      }

      const result = await updateContextStages({
        id: context.id,
        stages: stages.map((s) => ({ id: s.id, name: s.name, isTerminal: s.isTerminal })),
      });

      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader
        title={context.name}
        description={`${context.relationships} ${context.relationships === 1 ? "relationship" : "relationships"} · ${context.stages.length} ${context.stages.length === 1 ? "stage" : "stages"}`}
        action={
          canEdit && (
            <Button
              size="sm"
              variant={editing ? "ghost" : "secondary"}
              onClick={() => {
                setEditing(!editing);
                setError(null);
                setConfirming(false);
                if (editing) {
                  setName(context.name);
                  setStages(context.stages);
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

        {!editing ? (
          <div className="flex flex-wrap gap-1.5">
            {context.stages.map((stage) => (
              <Badge key={stage.id} tone={stage.isTerminal ? "grey" : "blue"}>
                {stage.name}
                {stage.count > 0 && <span className="opacity-60">· {stage.count}</span>}
              </Badge>
            ))}
          </div>
        ) : (
          <>
            <Field label="Name" htmlFor={`ctx-name-${context.id}`} required>
              <Input id={`ctx-name-${context.id}`} value={name} onChange={(e) => setName(e.currentTarget.value)} />
            </Field>

            <div className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Stages, in board order</p>

              {stages.map((stage, index) => (
                <div
                  key={stage.id ?? `new-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2"
                >
                  <Input
                    value={stage.name}
                    onChange={(e) => patch(index, { name: e.currentTarget.value })}
                    className="h-8 min-w-32 flex-1 text-[13px]"
                    aria-label={`Stage ${index + 1} name`}
                  />

                  <label
                    className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted"
                    title="A terminal stage ends the pipeline. Relationships on one drop out of the working board."
                  >
                    <input
                      type="checkbox"
                      checked={stage.isTerminal}
                      onChange={(e) => patch(index, { isTerminal: e.currentTarget.checked })}
                      className="size-3.5 accent-[var(--brand)]"
                    />
                    Closes
                  </label>

                  {stage.count > 0 && <Badge tone="grey">{stage.count}</Badge>}

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
                      disabled={index === stages.length - 1}
                      className="rounded p-1 text-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setStages(stages.filter((_, i) => i !== index))}
                      className="rounded p-1 text-muted hover:bg-rose-50 hover:text-[var(--red)]"
                      aria-label={`Remove ${stage.name}`}
                      title={
                        stage.count > 0
                          ? `${stage.count} ${stage.count === 1 ? "relationship sits" : "relationships sit"} here. Move them first — this save will be refused otherwise.`
                          : "Nothing is on this stage"
                      }
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="justify-self-start"
                onClick={() => setStages([...stages, { name: "", isTerminal: false, count: 0 }])}
              >
                <Plus />
                Add stage
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button variant="primary" loading={pending} onClick={save}>
                Save {context.name}
              </Button>

              {context.relationships === 0 ? (
                confirming ? (
                  <form
                    action={(formData) =>
                      start(async () => {
                        setError(null);
                        const result = await deleteContext({
                          id: context.id,
                          confirmName: String(formData.get("confirmName") ?? ""),
                        });
                        if (result.ok) router.refresh();
                        else setError(result.error);
                      })
                    }
                    className="ml-auto flex items-center gap-2"
                  >
                    <Input
                      name="confirmName"
                      placeholder={context.name}
                      className="h-8 w-36 text-[13px]"
                      aria-label={`Type ${context.name} to confirm`}
                      autoComplete="off"
                      required
                    />
                    <Button type="submit" size="sm" variant="danger" loading={pending}>
                      Delete
                    </Button>
                  </form>
                ) : (
                  <Button
                    variant="ghost"
                    className="ml-auto text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 />
                    Delete pipeline
                  </Button>
                )
              ) : (
                <span className="ml-auto text-xs text-muted">
                  Holds {context.relationships} {context.relationships === 1 ? "relationship" : "relationships"} — cannot
                  be deleted
                </span>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
