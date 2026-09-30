"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { archiveClient, deleteClient, restoreClient } from "../actions";

/**
 * Archive and delete, side by side, because the choice between them is the
 * whole point. Archiving is the one almost everybody wants; deletion is
 * refused outright while anything is attached, and the panel says so before
 * the button is pressed rather than after.
 */
export function DangerPanel({
  clientId,
  clientName,
  status,
  attachedCount,
  canArchive,
  canDelete,
}: {
  clientId: string;
  clientName: string;
  status: string;
  attachedCount: number;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const archived = status === "Archived";
  const deletable = attachedCount === 0;

  return (
    <Card className="border-rose-200">
      <CardHeader
        title="Archive or delete"
        description={archived ? "This client is archived" : "Archiving is almost always the right one"}
      />
      <CardBody className="grid gap-3">
        {error && <p className="text-sm text-[var(--red)]">{error}</p>}

        {canArchive &&
          (archived ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">
                It is hidden from the working list. Everything attached to it stayed where it was.
              </p>
              <Button
                variant="secondary"
                size="sm"
                loading={pending}
                className="justify-self-start"
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await restoreClient({ id: clientId, status: "Active" });
                    if (!result.ok) setError(result.error);
                    else router.refresh();
                  })
                }
              >
                <ArchiveRestore />
                Restore as active
              </Button>
            </div>
          ) : (
            <form
              action={(formData) =>
                start(async () => {
                  setError(null);
                  const result = await archiveClient({ id: clientId, reason: String(formData.get("reason") ?? "") || undefined });
                  if (!result.ok) setError(result.error);
                  else router.refresh();
                })
              }
              className="grid gap-2"
            >
              <Field label="Why (optional)" htmlFor="reason" hint="Recorded in the history, for whoever asks in six months">
                <Input id="reason" name="reason" placeholder="Contract ended" />
              </Field>
              <Button type="submit" variant="secondary" size="sm" loading={pending} className="justify-self-start">
                <Archive />
                Archive {clientName}
              </Button>
            </form>
          ))}

        {canDelete && (
          <div className="border-t border-border pt-3">
            {!deletable ? (
              <p className="text-sm text-muted">
                Deletion is refused: {attachedCount} {attachedCount === 1 ? "record is" : "records are"} attached. The
                money has to reconcile against a sheet somebody else keeps, and a deleted client takes its entries&apos;
                context with it. Archive instead.
              </p>
            ) : confirming ? (
              <form
                action={(formData) =>
                  start(async () => {
                    setError(null);
                    const result = await deleteClient({ id: clientId, confirmName: String(formData.get("confirmName") ?? "") });
                    if (!result.ok) setError(result.error);
                    else router.push("/clients");
                  })
                }
                className="grid gap-2"
              >
                <Field label={`Type "${clientName}" to confirm`} htmlFor="confirmName">
                  <Input id="confirmName" name="confirmName" placeholder={clientName} required autoFocus autoComplete="off" />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" size="sm" loading={pending}>
                    Delete permanently
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm text-muted">Nothing is attached, so this one can be deleted.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-start text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 />
                  Delete client
                </Button>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
