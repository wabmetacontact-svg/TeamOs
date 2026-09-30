"use client";

import { CLIENT_STATUSES } from "@/lib/ui-enums";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";

/**
 * Filters live in the URL rather than in component state, so a filtered list
 * can be sent to somebody, bookmarked, or reloaded without losing where you
 * were. The server does the filtering — this only decides what to ask for.
 */
export function ClientFilters({ brands }: { brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    start(() => router.replace(`/clients${next.toString() ? `?${next}` : ""}`, { scroll: false }));
  }

  // Typing should not fire a request per keystroke, and should not make you
  // press Enter either.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => apply({ q }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const archived = params.get("archived") === "1";
  const active = q || params.get("brand") || params.get("status") || archived;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search name, legal name or sub-tag"
          className="pl-8"
          aria-label="Search clients"
        />
      </div>

      <Select
        value={params.get("brand") ?? ""}
        onChange={(e) => apply({ brand: e.currentTarget.value })}
        aria-label="Filter by brand"
        className="w-auto min-w-32"
      >
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <Select
        value={params.get("status") ?? ""}
        onChange={(e) => apply({ status: e.currentTarget.value })}
        aria-label="Filter by status"
        className="w-auto min-w-32"
      >
        <option value="">Active statuses</option>
        {CLIENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-card">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => apply({ archived: e.currentTarget.checked ? "1" : "" })}
          className="size-4 accent-brand"
        />
        Show archived
      </label>

      {active && (
        <button
          type="button"
          onClick={() => start(() => router.replace("/clients", { scroll: false }))}
          className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
