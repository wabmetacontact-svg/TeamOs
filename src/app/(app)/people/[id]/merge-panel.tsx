"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { mergePeople, mergePreview } from "../merge-actions";

type Preview = {
  keepName: string;
  mergeName: string;
  relationships: number;
  activities: number;
  contacts: number;
  collisions: string[];
};

/**
 * Merging a duplicate into this person. This page is the one being kept, which
 * is the direction people think in — you are looking at the good record and
 * folding the stray one into it.
 */
export function MergePanel({
  keepId,
  keepName,
  hasEmail,
  hasPhone,
  candidates,
}: {
  keepId: string;
  keepName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  candidates: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mergeId, setMergeId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adoptEmail, setAdoptEmail] = useState(true);
  const [adoptPhone, setAdoptPhone] = useState(true);

  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Nobody else to merge in.</p>;
  }

  function look(id: string) {
    setMergeId(id);
    setPreview(null);
    setError(null);
    if (!id) return;

    start(async () => {
      const result = await mergePreview({ keepId, mergeId: id });
      if (result.ok && result.data) setPreview(result.data);
      else if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="grid gap-3">
      <Field
        label="Merge someone into this record"
        htmlFor="merge-id"
        hint="Everything they hold moves here, and their row is retired."
      >
        <Select id="merge-id" value={mergeId} onChange={(e) => look(e.currentTarget.value)}>
          <option value="">Choose a duplicate…</option>
          {candidates.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.email ? ` · ${person.email}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {preview && (
        <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3">
          {preview.collisions.length > 0 ? (
            <div className="flex items-start gap-2 text-sm text-orange-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>
                Both hold a {preview.collisions.join(" and ")} relationship. One of them has history the other does not,
                so this cannot be merged automatically — close or delete the one you do not want first.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm">
                Moving into {keepName}: <strong>{preview.relationships}</strong>{" "}
                {preview.relationships === 1 ? "relationship" : "relationships"}, <strong>{preview.activities}</strong>{" "}
                logged {preview.activities === 1 ? "item" : "items"}
                {preview.contacts > 0 && (
                  <>
                    , <strong>{preview.contacts}</strong> client {preview.contacts === 1 ? "link" : "links"}
                  </>
                )}
                .
              </p>

              {(!hasEmail || !hasPhone) && (
                <div className="grid gap-1.5">
                  {!hasEmail && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={adoptEmail}
                        onChange={(e) => setAdoptEmail(e.currentTarget.checked)}
                        className="size-4 accent-[var(--brand)]"
                      />
                      Take their email — {keepName} has none
                    </label>
                  )}
                  {!hasPhone && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={adoptPhone}
                        onChange={(e) => setAdoptPhone(e.currentTarget.checked)}
                        className="size-4 accent-[var(--brand)]"
                      />
                      Take their phone — {keepName} has none
                    </label>
                  )}
                </div>
              )}

              <p className="text-xs text-muted">
                {preview.mergeName}&rsquo;s row is retired rather than erased, with a note saying where it went. A
                relationship in a pipeline you cannot see moves too — it has to, or it would be stranded on a retired
                row.
              </p>

              <Button
                variant="primary"
                size="sm"
                loading={pending}
                className="justify-self-start"
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await mergePeople({ keepId, mergeId, adoptEmail, adoptPhone });
                    if (result.ok) {
                      setPreview(null);
                      setMergeId("");
                      router.refresh();
                    } else setError(result.error);
                  })
                }
              >
                <Merge />
                Merge {preview.mergeName} into {keepName}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
