"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** One control, used by every money screen. The month is always a filter. */
export function MonthPicker({ month, className }: { month: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function go(next: string) {
    const q = new URLSearchParams(params.toString());
    q.set("m", next);
    start(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("inline-flex items-center rounded-lg border border-border bg-surface shadow-card", className)}>
      <button
        onClick={() => go(shiftMonth(month, -1))}
        className="flex h-9 w-9 items-center justify-center rounded-l-lg text-muted hover:bg-surface-hover hover:text-fg"
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="flex h-9 min-w-40 items-center justify-center gap-2 border-x border-border px-3 text-sm font-medium">
        {monthLabel(month)}
        {pending && <Loader2 className="size-3.5 animate-spin text-subtle" />}
      </span>
      <button
        onClick={() => go(shiftMonth(month, 1))}
        className="flex h-9 w-9 items-center justify-center rounded-r-lg text-muted hover:bg-surface-hover hover:text-fg"
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
