"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PROTECTED_ROLE } from "@/lib/permissions";
import { inviteUser } from "./actions";
import { PermissionPicker } from "./permission-picker";

type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
};
type Client = { id: string; name: string; brand: string };

/**
 * Inviting somebody, and deciding exactly what they can reach.
 *
 * Access here is two separate decisions, and the dialog shows both:
 *
 *   features   what they can DO — see, add, approve, export — module by
 *              module. Picking a role ticks its defaults; any box can then be
 *              changed for this one person, and only the difference from the
 *              role is stored
 *
 *   clients    which clients they can do it TO — every client, or a hand-picked
 *              list
 *
 * There is no mail server yet, so the link is shown once and copied by hand.
 * That is stated plainly rather than hidden: an invitation the sender thinks
 * was emailed and was not is worse than one they know they have to paste.
 */
export function InviteButton({
  roles,
  clients,
  canGrantAllClients,
  granterPermissions,
}: {
  roles: Role[];
  clients: Client[];
  /** Somebody scoped to some clients cannot hand out every client. */
  canGrantAllClients: boolean;
  /** What the inviter holds: nobody hands out a feature they lack. */
  granterPermissions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const member = roles.find((r) => r.name === "Member") ?? roles[0];
  const [roleId, setRoleId] = useState(member?.id ?? "");
  const [allClients, setAllClients] = useState(canGrantAllClients);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const role = roles.find((r) => r.id === roleId);
  const roleKeys = useMemo(() => new Set(role?.permissions ?? []), [role]);
  const grantable = useMemo(() => new Set(granterPermissions), [granterPermissions]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(member?.permissions ?? []));

  function pickRole(id: string) {
    setRoleId(id);
    // A new role starts from its own defaults, not from edits made to another.
    setChosen(new Set(roles.find((r) => r.id === id)?.permissions ?? []));
  }

  const visible = clients.filter((c) => `${c.name} ${c.brand}`.toLowerCase().includes(filter.trim().toLowerCase()));

  function reset() {
    setError(null);
    setFields({});
    setLink(null);
    setCopied(false);
  }

  function resetAll() {
    reset();
    setRoleId(member?.id ?? "");
    setChosen(new Set(member?.permissions ?? []));
    setAllClients(canGrantAllClients);
    setPicked(new Set());
    setFilter("");
  }

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  function submit(formData: FormData) {
    reset();
    start(async () => {
      const result = await inviteUser({
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? "") || undefined,
        roleId,
        allClients,
        clientIds: allClients ? [] : [...picked],
        permissions: [...chosen],
      });

      if (result.ok) setLink(result.data?.link ?? null);
      else {
        setError(result.error);
        setFields(result.fieldErrors ?? {});
      }
    });
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <UserPlus />
          Invite someone
        </Button>
      </DialogTrigger>

      <DialogContent
        title={link ? "Send them this link" : "Invite someone"}
        description={
          link
            ? "It works once and expires in 72 hours. You will not be able to see it again after you close this."
            : "They choose their own password, so you never handle it."
        }
        className="sm:max-w-xl"
      >
        {link ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button
                type="button"
                variant={copied ? "primary" : "secondary"}
                size="icon"
                onClick={copy}
                aria-label="Copy link"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted">
              Anyone with this link can join with the access you picked, so send it the way you would send a password.
            </p>
            <Button type="button" variant="secondary" onClick={resetAll}>
              Invite someone else
            </Button>
          </div>
        ) : (
          <form action={submit} className="grid gap-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="email" error={fields.email?.[0]} required>
                <Input id="email" name="email" type="email" placeholder="priya@company.com" required autoFocus />
              </Field>

              <Field label="Name" htmlFor="name" error={fields.name?.[0]} hint="Optional — they can correct it">
                <Input id="name" name="name" placeholder="Priya Sharma" />
              </Field>
            </div>

            {/* What they can do */}
            <div className="grid gap-2">
              <Field label="Role — a starting point" htmlFor="roleId" error={fields.roleId?.[0]} required>
                <Select id="roleId" value={roleId} onChange={(e) => pickRole(e.currentTarget.value)} required>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {role && (
                <>
                  {role.description && <p className="text-xs text-muted">{role.description}</p>}
                  <p className="text-[13px] font-medium">Features — tick what they can use</p>
                  <PermissionPicker
                    value={chosen}
                    onChange={setChosen}
                    roleName={role.name}
                    roleKeys={roleKeys}
                    grantable={grantable}
                    disabled={role.name === PROTECTED_ROLE}
                  />
                  {role.name === PROTECTED_ROLE && (
                    <p className="text-xs text-muted">An Owner can always do everything.</p>
                  )}
                </>
              )}
            </div>

            {/* Which clients they can do it to */}
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">Clients — which ones they can reach</p>

              <label
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                  canGrantAllClients ? "border-border bg-surface-2" : "border-border bg-surface-2 opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={allClients}
                  disabled={!canGrantAllClients}
                  onChange={(e) => setAllClients(e.currentTarget.checked)}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span className="text-sm">
                  Every client
                  <span className="block text-xs text-muted">
                    {canGrantAllClients
                      ? "Including clients added later."
                      : "You can only give access to the clients you can see yourself."}
                  </span>
                </span>
              </label>

              {!allClients && (
                <div className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.currentTarget.value)}
                      placeholder="Filter clients"
                      className="h-8 text-[13px]"
                      aria-label="Filter clients"
                    />
                    <button
                      type="button"
                      onClick={() => setPicked(new Set(visible.map((c) => c.id)))}
                      className="shrink-0 text-xs font-medium text-brand hover:underline"
                    >
                      Select all
                    </button>
                    {picked.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setPicked(new Set())}
                        className="shrink-0 text-xs font-medium text-muted hover:text-fg"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {clients.length === 0 ? (
                    <p className="px-3 py-4 text-center text-sm text-muted">
                      No clients yet. Add one first, or give access to every client.
                    </p>
                  ) : (
                    <ul className="scrollbar-thin max-h-52 overflow-y-auto p-1">
                      {visible.map((client) => (
                        <li key={client.id}>
                          <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
                            <input
                              type="checkbox"
                              checked={picked.has(client.id)}
                              onChange={() => toggle(client.id)}
                              className="size-4 accent-brand"
                            />
                            <span className="min-w-0 flex-1 truncate">{client.name}</span>
                            <span className="shrink-0 text-xs text-subtle">{client.brand}</span>
                          </label>
                        </li>
                      ))}
                      {visible.length === 0 && (
                        <li className="px-2 py-3 text-center text-sm text-muted">Nothing matches that.</li>
                      )}
                    </ul>
                  )}

                  <p
                    className={`border-t border-border px-3 py-1.5 text-xs ${
                      fields.clientIds ? "text-[var(--red)]" : "text-muted"
                    }`}
                  >
                    {fields.clientIds?.[0] ??
                      `${picked.size} of ${clients.length} ${clients.length === 1 ? "client" : "clients"} selected`}
                  </p>
                </div>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={!allClients && picked.size === 0}
              className="mt-1"
            >
              Create invitation
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
