"use client";

import { DropdownMenu as M } from "radix-ui";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/dates";

/**
 * Downloads a CSV of whatever the screen is showing. Two choices only:
 * the month on screen, or everything. Plain links, so the browser handles
 * the download instead of the router trying to navigate.
 */
export function ExportButton({
  type,
  month,
  label = "Export",
}: {
  type: "tasks" | "salaries" | "transactions";
  month?: string;
  label?: string;
}) {
  const url = (scope: "month" | "all") => {
    const params = new URLSearchParams({ type });
    if (scope === "month" && month) params.set("m", month);
    return `/api/export?${params.toString()}`;
  };

  if (!month) {
    return (
      <Button asChild variant="secondary">
        <a href={url("all")} download>
          <Download className="size-4" /> {label}
        </a>
      </Button>
    );
  }

  return (
    <M.Root>
      <M.Trigger asChild>
        <Button variant="secondary">
          <Download /> {label}
        </Button>
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-xl border border-border bg-surface p-1 shadow-pop animate-in">
          <M.Item asChild>
            <a
              href={url("month")}
              download
              className="block cursor-pointer rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover"
            >
              {monthLabel(month)} only
            </a>
          </M.Item>
          <M.Item asChild>
            <a
              href={url("all")}
              download
              className="block cursor-pointer rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover"
            >
              Everything (all time)
            </a>
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
