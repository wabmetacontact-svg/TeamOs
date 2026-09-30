"use client";

import { ACTIVITY_TYPES } from "@/lib/ui-enums";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquare, Phone, StickyNote, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { logActivity } from "../../pipelines/actions";

type Activity = {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  actor: string;
  context: string | null;
};

const ICONS: Record<string, typeof Phone> = {
  Call: Phone,
  Meeting: Users,
  Message: MessageSquare,
  Note: StickyNote,
};

export function ActivityPanel({
  personId,
  activities,
  relationships,
  canEdit,
}: {
  personId: string;
  activities: Activity[];
  relationships: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {canEdit &&
        (adding ? (
          <form
            action={(formData) =>
              start(async () => {
                setError(null);
                const result = await logActivity({
                  personId,
                  relationshipId: String(formData.get("relationshipId") ?? "") || undefined,
                  type: String(formData.get("type") ?? "Note") as (typeof ACTIVITY_TYPES)[number],
                  subject: String(formData.get("subject") ?? ""),
                  body: String(formData.get("body") ?? "") || undefined,
                  occurredAt: String(formData.get("occurredAt") ?? "") || undefined,
                });
                if (result.ok) {
                  setAdding(false);
                  router.refresh();
                } else setError(result.error);
              })
            }
            className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="What" htmlFor="a-type">
                <Select id="a-type" name="type" defaultValue="Note">
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Pipeline"
                htmlFor="a-rel"
                hint={relationships.length ? undefined : "No pipeline — this will be a note about the person"}
              >
                <Select id="a-rel" name="relationshipId" defaultValue="">
                  <option value="">About the person</option>
                  {relationships.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="When" htmlFor="a-when">
                <Input id="a-when" name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>

            <Field label="Summary" htmlFor="a-subject" required>
              <Input id="a-subject" name="subject" placeholder="Seed terms discussed" required autoFocus />
            </Field>

            <Field label="Detail" htmlFor="a-body">
              <Textarea id="a-body" name="body" placeholder="What was actually said, and what happens next." />
            </Field>

            {error && <p className="text-sm text-[var(--red)]">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={pending}>
                Log it
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setAdding(true)}>
            Log something
          </Button>
        ))}

      {activities.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <ol className="grid gap-0.5">
          {activities.map((activity) => {
            const Icon = ICONS[activity.type] ?? StickyNote;
            return (
              <li key={activity.id} className="flex gap-2.5 border-l-2 border-border py-2 pl-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{activity.subject}</span>
                    {activity.context && <Badge tone="blue">{activity.context}</Badge>}
                  </div>
                  {activity.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{activity.body}</p>}
                  <p className="mt-0.5 text-xs text-subtle">
                    {activity.actor} ·{" "}
                    {new Date(activity.occurredAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
