"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, type Tone } from "@/components/ui/badge";

type Entry = {
  id: string;
  action: string;
  actor: string;
  resourceType: string;
  resourceId: string;
  resourceLabel: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};

/** Where a resource type lives, so an entry is one click from the thing itself. */
const ROUTES: Record<string, (id: string) => string | null> = {
  Client: (id) => `/clients/${id}`,
  Transaction: (id) => `/ledger/${id}`,
  Task: (id) => `/tasks/${id}`,
  Person: (id) => `/people/${id}`,
  Relationship: () => `/pipelines`,
  User: () => `/team`,
  Brand: () => `/brands`,
  Context: () => `/pipelines/manage`,
  BookMonth: () => `/ledger/months`,
};

export function AuditEntry({ entry, timeZone }: { entry: Entry; timeZone: string }) {
  const [open, setOpen] = useState(false);

  const fields = changedFields(entry);
  const href = ROUTES[entry.resourceType]?.(entry.resourceId) ?? null;

  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{entry.actor}</span>
        <span className="text-muted">{entry.action.replace(/_/g, " ")}</span>

        {href ? (
          <Link href={href} className="truncate text-brand hover:underline">
            {entry.resourceLabel ?? entry.resourceType}
          </Link>
        ) : (
          <span className="truncate">{entry.resourceLabel ?? entry.resourceType}</span>
        )}

        <Badge tone={toneFor(entry.action)}>{entry.resourceType}</Badge>

        {fields.length > 0 && (
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-brand hover:underline">
            {open ? "hide" : `${fields.length} ${fields.length === 1 ? "field" : "fields"}`}
          </button>
        )}

        <span className="ml-auto whitespace-nowrap text-xs text-subtle">
          {new Date(entry.createdAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
            timeZone,
          })}
        </span>
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

          <div className="mt-1 border-t border-border pt-1 text-subtle">
            <code className="font-mono text-[10px]">{entry.resourceId}</code>
            {entry.ip && <span className="ml-2">from {entry.ip}</span>}
          </div>
        </dl>
      )}
    </div>
  );
}

function changedFields(entry: Entry): string[] {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  // A creation has only an after, and every one of its fields is worth
  // showing. A change shows only what moved.
  if (Object.keys(before).length === 0) return keys;
  return keys.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function read(source: unknown, field: string): unknown {
  return asRecord(source)[field];
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

function toneFor(action: string): Tone {
  if (/deleted|rejected|revoked|deactivated|disabled/.test(action)) return "red";
  if (/created|approved|verified|enabled|accepted/.test(action)) return "green";
  if (/closed|reopened|changed|updated/.test(action)) return "orange";
  return "grey";
}
