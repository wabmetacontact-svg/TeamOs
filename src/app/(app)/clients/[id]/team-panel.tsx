"use client";

import { useState, useTransition } from "react";
import { UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { assignUserToClient, removeUserFromClient } from "../actions";

type Assigned = { userId: string; name: string; email: string; roleName: string; status: string };

/**
 * Assignment is not a label — it is the grant. Someone on this list can open
 * this client; someone who is not gets the same 404 as for a client that does
 * not exist. The copy says so, because a list that looks decorative gets
 * treated as decorative.
 */
export function TeamPanel({
  clientId,
  assigned,
  assignable,
  canEdit,
}: {
  clientId: string;
  assigned: Assigned[];
  assignable: { id: string; name: string; email: string }[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {assigned.length === 0 ? (
        <p className="text-sm text-muted">
          Nobody is assigned. Anyone whose role covers every client can still see this; nobody else can.
        </p>
      ) : (
        <ul className="grid gap-2">
          {assigned.map((person) => (
            <li key={person.userId} className="flex items-center gap-2.5">
              <Avatar name={person.name} className={person.status === "Active" ? undefined : "opacity-50"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{person.name}</p>
                <p className="truncate text-xs text-muted">{person.email}</p>
              </div>
              <Badge tone={person.status === "Active" ? "grey" : "red"}>
                {person.status === "Active" ? person.roleName : "Deactivated"}
              </Badge>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const result = await removeUserFromClient({ clientId, userId: person.userId });
                      if (!result.ok) setError(result.error);
                    })
                  }
                  className="rounded-md p-1.5 text-muted hover:bg-rose-50 hover:text-[var(--red)]"
                  aria-label={`Remove ${person.name}`}
                >
                  <UserMinus className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      {canEdit && assignable.length > 0 && (
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const userId = String(formData.get("userId") ?? "");
              if (!userId) return;
              const result = await assignUserToClient({ clientId, userId });
              if (!result.ok) setError(result.error);
            })
          }
          className="flex gap-2"
        >
          <Select name="userId" defaultValue="" aria-label="Give someone access" className="h-8 flex-1 text-[13px]">
            <option value="">Give someone access…</option>
            {assignable.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Add
          </Button>
        </form>
      )}

      {canEdit && assignable.length === 0 && assigned.length > 0 && (
        <p className="text-xs text-muted">Everyone else already sees every client.</p>
      )}
    </div>
  );
}
