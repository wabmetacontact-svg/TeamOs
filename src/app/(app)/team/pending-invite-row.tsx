"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { revokeInvitation } from "./actions";

export function PendingInviteRow({
  invite,
}: {
  invite: { id: string; email: string; roleName: string; invitedByName: string; expiresAt: string };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const expires = new Date(invite.expiresAt);
  const hoursLeft = Math.round((expires.getTime() - Date.now()) / 3600_000);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-subtle">
        <Mail className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.email}</p>
        <p className="truncate text-xs text-muted">
          Invited by {invite.invitedByName} ·{" "}
          {hoursLeft <= 0 ? "expired" : `${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left`}
        </p>
      </div>

      <Badge tone={hoursLeft <= 0 ? "red" : "orange"}>{hoursLeft <= 0 ? "Expired" : invite.roleName}</Badge>

      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await revokeInvitation({ id: invite.id });
            if (!result.ok) setError(result.error);
          });
        }}
        className="text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
      >
        Revoke
      </Button>

      {error && <p className="w-full pl-10 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
