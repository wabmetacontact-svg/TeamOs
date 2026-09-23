import { formatMoney } from "@/lib/money";

/**
 * Ranked horizontal bars — the honest way to show "where the money went".
 * Server component, one hue, value labelled directly so no legend is needed.
 */
export function BarList({
  rows,
  emptyLabel = "Nothing to show yet",
}: {
  rows: { id: string; label: string; amount: number; count?: number }[];
  emptyLabel?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="tabular shrink-0 font-medium">
              {formatMoney(r.amount)}
              <span className="ml-1.5 text-xs font-normal text-muted">{total ? Math.round((r.amount / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max((r.amount / max) * 100, 2)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
