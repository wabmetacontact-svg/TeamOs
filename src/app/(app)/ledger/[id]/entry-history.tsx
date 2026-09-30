"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

type Entry = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  before: unknown;
  after: unknown;
};

const VERBS: Record<string, string> = {
  created: "entered this",
  updated: "changed",
  updated_after_approval: "changed it after approval",
  submitted: "submitted it",
  approved: "approved it",
  rejected: "rejected it",
  deleted: "removed it",
  restored: "restored it",
  attachment_added: "attached a receipt",
  attachment_removed: "removed a receipt",
};

/** Fields worth showing a before and after for, in the order people read them. */
const FIELDS = ["name", "amountBase", "amountOriginal", "bookMonth", "direction", "paymentStatus", "approvalState", "categoryId"] as const;

export function EntryHistory({ entries, baseCurrency }: { entries: Entry[]; baseCurrency: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) return <p className="text-sm text-muted">Nothing since it was entered.</p>;

  return (
    <ol className="grid gap-0.5">
      {entries.map((entry) => {
        const changed = changedFields(entry);
        const open = expanded === entry.id;

        return (
          <li key={entry.id} className="border-l-2 border-border py-1.5 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="font-medium">{entry.actor}</span>
              <span className="text-muted">{VERBS[entry.action] ?? entry.action.replace(/_/g, " ")}</span>

              {changed.length > 0 && (
                <button type="button" onClick={() => setExpanded(open ? null : entry.id)} className="text-brand hover:underline">
                  {changed.length === 1 ? label(changed[0]!) : `${changed.length} fields`}
                </button>
              )}

              {reason(entry) && <span className="text-muted">— {reason(entry)}</span>}

              <span className="ml-auto whitespace-nowrap text-xs text-subtle">{when(entry.createdAt)}</span>
            </div>

            {open && (
              <dl className="mt-1.5 grid gap-1 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
                {changed.map((field) => (
                  <div key={field} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-muted">{label(field)}</dt>
                    <dd className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-subtle line-through">{show(field, read(entry.before, field), baseCurrency)}</span>
                      <span aria-hidden>→</span>
                      <span className="font-medium">{show(field, read(entry.after, field), baseCurrency)}</span>
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
  const before = entry.before as Record<string, unknown> | null;
  const after = entry.after as Record<string, unknown> | null;
  if (!before || !after) return [];

  return FIELDS.filter((field) => field in before || field in after).filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null),
  );
}

function reason(entry: Entry): string | null {
  const after = entry.after as Record<string, unknown> | null;
  const value = after?.reason;
  return typeof value === "string" && value ? value : null;
}

function read(source: unknown, field: string): unknown {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[field] : undefined;
}

function label(field: string): string {
  return (
    {
      amountBase: "Amount",
      amountOriginal: "Amount as paid",
      bookMonth: "Book month",
      paymentStatus: "Payment",
      approvalState: "State",
      categoryId: "Category",
    }[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

function show(field: string, value: unknown, baseCurrency: string): string {
  if (value == null || value === "") return "empty";
  // Amounts travel through the audit log as strings, because BigInt is not JSON.
  if (field === "amountBase") return formatMoney(BigInt(String(value)), baseCurrency);
  if (field === "amountOriginal") return String(Number(value) / 100);
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
