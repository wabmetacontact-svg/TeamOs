"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/task-rules";

export function TaskFilters({
  clients,
  people,
}: {
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    next.set("view", "all");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    start(() => router.replace(`/tasks?${next}`, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const timer = setTimeout(() => apply({ q }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = q || params.get("status") || params.get("assignee") || params.get("client") || params.get("priority") || params.get("overdue");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search name, notes or category"
          className="pl-8"
          aria-label="Search tasks"
        />
      </div>

      <Select value={params.get("assignee") ?? ""} onChange={(e) => apply({ assignee: e.currentTarget.value })} aria-label="Assignee" className="w-auto min-w-28">
        <option value="">Anyone</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>

      <Select value={params.get("status") ?? ""} onChange={(e) => apply({ status: e.currentTarget.value })} aria-label="Status" className="w-auto min-w-28">
        <option value="">Open only</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <Select value={params.get("priority") ?? ""} onChange={(e) => apply({ priority: e.currentTarget.value })} aria-label="Priority" className="w-auto">
        <option value="">Any priority</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>

      <Select value={params.get("client") ?? ""} onChange={(e) => apply({ client: e.currentTarget.value })} aria-label="Client" className="w-auto min-w-28">
        <option value="">Any client</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-card">
        <input
          type="checkbox"
          checked={params.get("overdue") === "1"}
          onChange={(e) => apply({ overdue: e.currentTarget.checked ? "1" : "" })}
          className="size-4 accent-[var(--brand)]"
        />
        Overdue only
      </label>

      {active && (
        <button
          type="button"
          onClick={() => start(() => router.replace("/tasks?view=all", { scroll: false }))}
          className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
