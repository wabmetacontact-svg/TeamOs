"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { changeUserRole, setUserStatus } from "./actions";
import { AccessDialog } from "./access-dialog";

type Person = {
  id: string;
  name: string;
  email: string;
  status: string;
  roleId: string;
  roleName: string;
  allClients: boolean;
  clientCount: number;
  clientIds: string[];
  roleKeys: string[];
  permissions: string[];
  /** How many features differ from their role. */
  customised: number;
  lastLoginAt: string | null;
};

export function PersonRow({
  person,
  roles,
  isSelf,
  canAssignRole,
  canDeactivate,
  canEditAccess,
  grantable,
  clients,
}: {
  person: Person;
  roles: { id: string; name: string }[];
  isSelf: boolean;
  canAssignRole: boolean;
  canDeactivate: boolean;
  canEditAccess: boolean;
  /** Keys the viewer may turn on for somebody. */
  grantable: string[];
  clients: { id: string; name: string; hint?: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const deactivated = person.status !== "Active";

  function onRoleChange(roleId: string) {
    setError(null);
    start(async () => {
      const result = await changeUserRole({ userId: person.id, roleId });
      if (!result.ok) setError(result.error);
    });
  }

  function toggleStatus() {
    setError(null);
    start(async () => {
      const result = await setUserStatus({
        userId: person.id,
        status: deactivated ? "Active" : "Deactivated",
      });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar name={person.name} className={deactivated ? "opacity-50" : undefined} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate text-sm font-medium ${deactivated ? "text-muted" : ""}`}>{person.name}</span>
            {isSelf && <Badge tone="blue">You</Badge>}
            {deactivated && <Badge tone="grey">Deactivated</Badge>}
            {person.customised > 0 && (
              <Badge tone="orange">
                {person.customised} custom {person.customised === 1 ? "feature" : "features"}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted">
            {person.email} · {person.allClients ? "all clients" : `${person.clientCount} assigned`} ·{" "}
            {person.lastLoginAt
              ? `last in ${new Date(person.lastLoginAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
              : "never signed in"}
          </p>
        </div>

        {canAssignRole && !isSelf ? (
          <Select
            aria-label={`Role for ${person.name}`}
            value={person.roleId}
            disabled={pending}
            onChange={(e) => onRoleChange(e.currentTarget.value)}
            className="h-8 w-36 text-[13px]"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={deactivated ? "grey" : "blue"}>{person.roleName}</Badge>
        )}

        {(canEditAccess || (canAssignRole && !isSelf)) && (
          <AccessDialog
            user={{
              id: person.id,
              name: person.name,
              roleName: person.roleName,
              allClients: person.allClients,
              clientIds: person.clientIds,
              roleKeys: person.roleKeys,
              permissions: person.permissions,
            }}
            clients={clients}
            canEditClients={canEditAccess}
            canEditFeatures={canAssignRole && !isSelf}
            grantable={grantable}
          />
        )}

        {canDeactivate && !isSelf && (
          <Button
            size="sm"
            variant={deactivated ? "secondary" : "ghost"}
            loading={pending}
            onClick={toggleStatus}
            className={deactivated ? undefined : "text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"}
          >
            {deactivated ? "Reactivate" : "Deactivate"}
          </Button>
        )}
      </div>

      {error && <p className="mt-2 pl-10 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
