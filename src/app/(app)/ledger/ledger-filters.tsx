"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { APPROVAL_STATES } from "@/lib/ledger-enums";

export function LedgerFilters({
  clients,
  categories,
  month,
}: {
  clients: { id: string; name: string }[];
  categories: { id: string; name: string; parent?: { name: string } | null }[];
  month: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    // The month is the page's anchor, so it survives every other change.
    next.set("month", month);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    start(() => router.replace(`/ledger?${next}`, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => apply({ q }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = q || params.get("client") || params.get("category") || params.get("state") || params.get("direction") || params.get("mine");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search payee, note, reference or tag"
          className="pl-8"
          aria-label="Search the ledger"
        />
      </div>

      <Select value={params.get("client") ?? ""} onChange={(e) => apply({ client: e.currentTarget.value })} aria-label="Client" className="w-auto min-w-28">
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Select value={params.get("category") ?? ""} onChange={(e) => apply({ category: e.currentTarget.value })} aria-label="Category" className="w-auto min-w-28">
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.parent ? `${c.parent.name} · ${c.name}` : c.name}
          </option>
        ))}
      </Select>

      <Select value={params.get("direction") ?? ""} onChange={(e) => apply({ direction: e.currentTarget.value })} aria-label="Direction" className="w-auto">
        <option value="">In and out</option>
        <option value="OUT">Out only</option>
        <option value="IN">In only</option>
      </Select>

      <Select value={params.get("state") ?? ""} onChange={(e) => apply({ state: e.currentTarget.value })} aria-label="Approval state" className="w-auto min-w-28">
        <option value="">Any state</option>
        {APPROVAL_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-card">
        <input
          type="checkbox"
          checked={params.get("mine") === "1"}
          onChange={(e) => apply({ mine: e.currentTarget.checked ? "1" : "" })}
          className="size-4 accent-[var(--brand)]"
        />
        Only mine
      </label>

      {active && (
        <button
          type="button"
          onClick={() => start(() => router.replace(`/ledger?month=${month}`, { scroll: false }))}
          className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
