import * as React from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

const tones: Record<Tone, string> = {
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function Badge({
  tone = "grey",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
