"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function DirectoryFilters() {
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
    start(() => router.replace(`/people${next.toString() ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => apply({ q }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = q;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search name, email or notes"
          className="pl-8"
          aria-label="Search people"
        />
      </div>

      {active && (
        <button
          type="button"
          onClick={() => start(() => router.replace("/people", { scroll: false }))}
          className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
