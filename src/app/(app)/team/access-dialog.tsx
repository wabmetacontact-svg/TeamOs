"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setUserAccess } from "./access-actions";
import { setUserPermissions } from "./actions";
import { PermissionPicker } from "./permission-picker";

type Option = { id: string; name: string; hint?: string };

export function AccessDialog({
  user,
  clients,
  canEditClients,
  canEditFeatures,
  grantable,
}: {
  user: {
    id: string;
    name: string;
    roleName: string;
    allClients: boolean;
    clientIds: string[];
    /** What their role grants. */
    roleKeys: string[];
    /** What they can actually do: the role with their personal changes applied. */
    permissions: string[];
  };
  clients: Option[];
  canEditClients: boolean;
  /** Choosing features is choosing permissions, which is `user:assign_role`. */
  canEditFeatures: boolean;
  /** What the person editing holds, plus what this person was already given. */
  grantable: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [allClients, setAllClients] = useState(user.allClients);
  const [clientIds, setClientIds] = useState<string[]>(user.clientIds);
  const [filter, setFilter] = useState("");
  const [features, setFeatures] = useState<Set<string>>(() => new Set(user.permissions));

  const roleKeys = useMemo(() => new Set(user.roleKeys), [user.roleKeys]);
  const grantableSet = useMemo(() => new Set(grantable), [grantable]);
  const featuresChanged =
    features.size !== user.permissions.length || user.permissions.some((key) => !features.has(key));

  const isOwner = user.roleName === "Owner";
  const shown = clients.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function save() {
    setError(null);
    start(async () => {
      if (canEditFeatures && !isOwner && featuresChanged) {
        const result = await setUserPermissions({
          userId: user.id,
          permissions: [...features],
        });
        if (!result.ok) return setError(result.error);
      }
      if (canEditClients && !isOwner) {
        const result = await setUserAccess({
          userId: user.id,
          allClients,
          clientIds,
        });
        if (!result.ok) return setError(result.error);
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAllClients(user.allClients);
          setClientIds(user.clientIds);
          setFeatures(new Set(user.permissions));
          setError(null);
          setFilter("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <KeyRound />
          Access
        </Button>
      </DialogTrigger>

      <DialogContent
        title={`What ${user.name} can do`}
        description={`Features start from their role (${user.roleName}) and can be changed for them alone. Clients decide what they can do it to.`}
        className="sm:max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={save} disabled={isOwner}>
              Save access
            </Button>
          </>
        }
      >
        <div className="grid gap-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          {isOwner && (
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
              An Owner sees everything by definition. Change their role first if that is not what you want.
            </p>
          )}

          {canEditFeatures && !isOwner && (
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Features</h3>
              <PermissionPicker
                value={features}
                onChange={setFeatures}
                roleName={user.roleName}
                roleKeys={roleKeys}
                grantable={grantableSet}
              />
              <p className="text-xs text-muted">Changing their role later clears these changes.</p>
            </section>
          )}

          {canEditClients && (
            <Axis
              title="Clients"
              allLabel="Every client, including ones added later"
              all={allClients}
              onAll={setAllClients}
              disabled={isOwner}
              selectedCount={clientIds.length}
              total={clients.length}
            >
              {clients.length > 8 && (
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.currentTarget.value)}
                  placeholder="Filter clients"
                  className="mb-2 h-8 text-[13px]"
                  aria-label="Filter clients"
                />
              )}
              <div className="scrollbar-thin grid max-h-52 gap-1 overflow-y-auto">
                {shown.map((client) => (
                  <Toggle
                    key={client.id}
                    label={client.name}
                    hint={client.hint}
                    checked={clientIds.includes(client.id)}
                    onChange={(on) =>
                      setClientIds(on ? [...clientIds, client.id] : clientIds.filter((id) => id !== client.id))
                    }
                  />
                ))}
                {shown.length === 0 && <p className="px-1 py-2 text-sm text-muted">Nothing matches that.</p>}
              </div>
            </Axis>
          )}

          <p className="text-xs text-muted">
            Takes effect on their next page load. Anything they are scoped out of returns the same &ldquo;not
            found&rdquo; as something that was never there.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Axis({
  title,
  allLabel,
  all,
  onAll,
  disabled,
  selectedCount,
  total,
  children,
}: {
  title: string;
  allLabel: string;
  all: boolean;
  onAll: (value: boolean) => void;
  disabled: boolean;
  selectedCount: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted">{all ? `all ${total}` : `${selectedCount} of ${total}`}</span>
      </div>

      <label className="mb-2 flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <input
          type="checkbox"
          checked={all}
          disabled={disabled}
          onChange={(e) => onAll(e.currentTarget.checked)}
          className="mt-0.5 size-4 accent-brand"
        />
        <span className="text-sm">{allLabel}</span>
      </label>

      {!all && <div className={disabled ? "pointer-events-none opacity-50" : undefined}>{children}</div>}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="size-4 accent-brand"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-subtle">{hint}</span>}
    </label>
  );
}
