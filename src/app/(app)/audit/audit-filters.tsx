"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";

const RESOURCE_TYPES = ["Client", "Transaction", "Task", "Person", "Relationship", "User", "Brand", "Context", "BookMonth"];

export function AuditFilters({
  people,
  actions,
}: {
  people: { id: string; name: string }[];
  actions: string[];
}) {
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
    start(() => router.replace(`/audit${next.toString() ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => apply({ q }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = q || params.get("actor") || params.get("action") || params.get("type") || params.get("from") || params.get("to");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search by what it was called, or paste an id"
          className="pl-8"
          aria-label="Search the audit log"
        />
      </div>

      <Select value={params.get("actor") ?? ""} onChange={(e) => apply({ actor: e.currentTarget.value })} aria-label="Who" className="w-auto min-w-28">
        <option value="">Anyone</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>

      <Select value={params.get("action") ?? ""} onChange={(e) => apply({ action: e.currentTarget.value })} aria-label="Action" className="w-auto min-w-28">
        <option value="">Any action</option>
        {actions.map((a) => (
          <option key={a} value={a}>
            {a.replace(/_/g, " ")}
          </option>
        ))}
      </Select>

      <Select value={params.get("type") ?? ""} onChange={(e) => apply({ type: e.currentTarget.value })} aria-label="Resource type" className="w-auto min-w-28">
        <option value="">Anything</option>
        {RESOURCE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>

      <Input
        type="date"
        value={params.get("from") ?? ""}
        onChange={(e) => apply({ from: e.currentTarget.value })}
        aria-label="From"
        className="w-auto"
      />
      <Input
        type="date"
        value={params.get("to") ?? ""}
        onChange={(e) => apply({ to: e.currentTarget.value })}
        aria-label="To"
        className="w-auto"
      />

      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            start(() => router.replace("/audit", { scroll: false }));
          }}
          className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
