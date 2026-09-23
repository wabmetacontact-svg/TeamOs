import { cn } from "@/lib/utils";

/** The number-first tiles used on Dashboard, Tasks and Salaries. */
export function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "blue" | "green" | "red" | "orange";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4 shadow-card", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-2 text-2xl font-semibold tracking-tight",
          tone === "blue" && "text-brand",
          tone === "green" && "text-[var(--green)]",
          tone === "red" && "text-[var(--red)]",
          tone === "orange" && "text-[var(--orange)]",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
