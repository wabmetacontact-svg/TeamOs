"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setUserAccess } from "./access-actions";

type Option = { id: string; name: string; hint?: string };

export function AccessDialog({
  user,
  clients,
  contexts,
}: {
  user: { id: string; name: string; roleName: string; allClients: boolean; clientIds: string[]; allContexts: boolean; contextIds: string[] };
  clients: Option[];
  contexts: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [allClients, setAllClients] = useState(user.allClients);
  const [clientIds, setClientIds] = useState<string[]>(user.clientIds);
  const [allContexts, setAllContexts] = useState(user.allContexts);
  const [contextIds, setContextIds] = useState<string[]>(user.contextIds);
  const [filter, setFilter] = useState("");

  const isOwner = user.roleName === "Owner";
  const shown = clients.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function save() {
    setError(null);
    start(async () => {
      const result = await setUserAccess({ userId: user.id, allClients, clientIds, allContexts, contextIds });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
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
          setAllContexts(user.allContexts);
          setContextIds(user.contextIds);
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
        title={`What ${user.name} can reach`}
        description="Clients and pipelines are separate. Someone can run two clients and still be trusted with a whole pipeline, or the other way round."
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

          <Axis
            title="Pipelines"
            allLabel="Every pipeline, including ones added later"
            all={allContexts}
            onAll={setAllContexts}
            disabled={isOwner}
            selectedCount={contextIds.length}
            total={contexts.length}
          >
            <div className="grid gap-1">
              {contexts.map((context) => (
                <Toggle
                  key={context.id}
                  label={context.name}
                  hint={context.hint}
                  checked={contextIds.includes(context.id)}
                  onChange={(on) =>
                    setContextIds(on ? [...contextIds, context.id] : contextIds.filter((id) => id !== context.id))
                  }
                />
              ))}
              {contexts.length === 0 && <p className="px-1 py-2 text-sm text-muted">No pipelines exist yet.</p>}
            </div>
          </Axis>

          <p className="text-xs text-muted">
            Takes effect on their next page load. Anything they are scoped out of returns the same &ldquo;not
            found&rdquo; as something that was never there — except a relationship, where they are told one exists and
            nothing about it.
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
          className="mt-0.5 size-4 accent-[var(--brand)]"
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
        className="size-4 accent-[var(--brand)]"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-subtle">{hint}</span>}
    </label>
  );
}
