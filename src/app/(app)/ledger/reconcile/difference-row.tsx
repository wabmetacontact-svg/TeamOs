"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBookMonth, formatMoney } from "@/lib/money";
import { reopenReconciliation, resolveMonth } from "./actions";

type Row = {
  clientId: string;
  clientName: string;
  month: string;
  expectedIncome: string;
  expectedSpend: string;
  actualIncome: string;
  actualSpend: string;
  incomeDelta: string;
  spendDelta: string;
  unapproved: number;
  unapprovedValue: string;
  entries: number;
  matches: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  source: string | null;
};

export function DifferenceRow({ row, currency, canResolve }: { row: Row; currency: string; canResolve: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const settled = Boolean(row.resolvedAt);
  const incomeDelta = BigInt(row.incomeDelta);
  const spendDelta = BigInt(row.spendDelta);

  // A month short by exactly the value of its unapproved rows is not a
  // mismatch — it is a month somebody has not finished approving. Saying so
  // saves an afternoon of looking for a row that is sitting in the queue.
  const explainedByQueue =
    !row.matches && row.unapproved > 0 && spendDelta < 0n && -spendDelta === BigInt(row.unapprovedValue) && incomeDelta === 0n;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <Link
            href={`/ledger?month=${row.month}&client=${row.clientId}&state=`}
            className="truncate text-sm font-medium hover:underline"
          >
            {row.clientName} · {formatBookMonth(row.month)}
          </Link>
          <p className="truncate text-xs text-muted">
            {row.entries} approved {row.entries === 1 ? "entry" : "entries"}
            {row.source && ` · from ${row.source}`}
          </p>
        </div>

        {settled ? (
          <Badge tone="green">
            <CheckCircle2 className="size-3" />
            Settled{row.resolvedBy && ` by ${row.resolvedBy}`}
          </Badge>
        ) : row.matches ? (
          <Badge tone="blue">Agrees — not settled</Badge>
        ) : explainedByQueue ? (
          <Badge tone="orange">Short by the queue</Badge>
        ) : (
          <Badge tone="red">Differs</Badge>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Figure label="Sheet · in" value={formatMoney(BigInt(row.expectedIncome), currency)} />
        <Figure label="Ledger · in" value={formatMoney(BigInt(row.actualIncome), currency)} delta={incomeDelta} currency={currency} />
        <Figure label="Sheet · out" value={formatMoney(BigInt(row.expectedSpend), currency)} />
        <Figure label="Ledger · out" value={formatMoney(BigInt(row.actualSpend), currency)} delta={spendDelta} currency={currency} />
      </div>

      {row.unapproved > 0 && (
        <p className="mt-1.5 text-xs text-orange-700">
          {row.unapproved} unapproved {row.unapproved === 1 ? "entry" : "entries"} ·{" "}
          {formatMoney(BigInt(row.unapprovedValue), currency)} — not in the ledger figure yet.
        </p>
      )}

      {row.note && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted">{row.note}</p>}
      {error && <p className="mt-1.5 text-xs text-[var(--red)]">{error}</p>}

      {canResolve && !settled && !settling && (
        <Button size="sm" variant={row.matches ? "primary" : "secondary"} className="mt-2" onClick={() => setSettling(true)}>
          Settle this month
        </Button>
      )}

      {canResolve && settling && (
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await resolveMonth({
                clientId: row.clientId,
                month: row.month,
                note: String(formData.get("note") ?? "") || undefined,
              });
              if (result.ok) {
                setSettling(false);
                router.refresh();
              } else setError(result.error);
            })
          }
          className="mt-2 grid gap-2"
        >
          <textarea
            name="note"
            rows={2}
            required={!row.matches}
            placeholder={
              row.matches
                ? "Optional — the figures agree exactly"
                : "Required — what accounts for the difference? e.g. the sheet double-counted the April retainer"
            }
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" loading={pending}>
              Settle
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSettling(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {canResolve && settled && (
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await reopenReconciliation({
                clientId: row.clientId,
                month: row.month,
                reason: String(formData.get("reason") ?? ""),
              });
              if (result.ok) router.refresh();
              else setError(result.error);
            })
          }
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input
            name="reason"
            required
            placeholder="Reopen — why?"
            className="h-8 min-w-40 flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus:border-brand"
          />
          <Button type="submit" size="sm" variant="ghost" loading={pending}>
            Reopen
          </Button>
        </form>
      )}
    </div>
  );
}

function Figure({ label, value, delta, currency }: { label: string; value: string; delta?: bigint; currency?: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2 py-1.5">
      <p className="text-subtle">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
      {delta != null && delta !== 0n && (
        <p className={`tabular-nums ${delta > 0n ? "text-orange-700" : "text-[var(--red)]"}`}>
          {delta > 0n ? "+" : "−"}
          {formatMoney(delta > 0n ? delta : -delta, currency).replace("−", "")}
          <span className="text-subtle"> {delta > 0n ? "more than sheet" : "less than sheet"}</span>
        </p>
      )}
    </div>
  );
}
