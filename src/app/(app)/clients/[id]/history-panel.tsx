"use client";

import { useState } from "react";

type Entry = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  before: unknown;
  after: unknown;
};

const VERBS: Record<string, string> = {
  created: "created this client",
  updated: "changed",
  archived: "archived it",
  restored: "restored it",
  deleted: "deleted it",
  access_granted: "gave access to",
  access_revoked: "removed access for",
  contact_added: "added a contact",
  contact_removed: "removed a contact",
};

/**
 * The change history, which is the audit log filtered to this client rather
 * than a second table kept alongside it. One append-only source, so a change
 * cannot exist in one place and not the other.
 */
export function HistoryPanel({ entries }: { entries: Entry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="text-sm text-muted">Nothing has changed since this client was added.</p>;
  }

  return (
    <ol className="grid gap-0.5">
      {entries.map((entry) => {
        const fields = changedFields(entry);
        const open = expanded === entry.id;

        return (
          <li key={entry.id} className="border-l-2 border-border py-1.5 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="font-medium">{entry.actor}</span>
              <span className="text-muted">{VERBS[entry.action] ?? entry.action.replace(/_/g, " ")}</span>
              {fields.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : entry.id)}
                  className="text-brand hover:underline"
                >
                  {fields.length === 1 ? label(fields[0]!) : `${fields.length} fields`}
                </button>
              )}
              <span className="ml-auto whitespace-nowrap text-xs text-subtle">{when(entry.createdAt)}</span>
            </div>

            {open && (
              <dl className="mt-1.5 grid gap-1 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
                {fields.map((field) => (
                  <div key={field} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-muted">{label(field)}</dt>
                    <dd className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-subtle line-through">{show(read(entry.before, field))}</span>
                      <span aria-hidden>→</span>
                      <span className="font-medium">{show(read(entry.after, field))}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function changedFields(entry: Entry): string[] {
  if (entry.action !== "updated") return [];
  const before = entry.before as Record<string, unknown> | null;
  const after = entry.after as Record<string, unknown> | null;
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
}

function read(source: unknown, field: string): unknown {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[field] : undefined;
}

function label(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function show(value: unknown): string {
  if (value == null || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null && v !== "");
    return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ") : "empty";
  }
  return String(value);
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
