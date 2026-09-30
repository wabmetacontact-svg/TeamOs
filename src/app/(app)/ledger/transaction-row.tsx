"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Paperclip, X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { decideTransaction, submitTransaction } from "./actions";

type Transaction = {
  id: string;
  ref: string;
  name: string;
  direction: string;
  date: string;
  clientName: string;
  categoryName: string | null;
  vendorName: string | null;
  amountBase: string;
  amountOriginal: string;
  currencyOriginal: string;
  approvalState: string;
  /** Imported already approved from a sheet; nobody approved it here. */
  approvalInferred?: boolean;
  paymentStatus: string;
  attachments: number;
  createdBy: string;
};

export function TransactionRow({
  transaction,
  canApprove,
  isMine,
  baseCurrency,
}: {
  transaction: Transaction;
  canApprove: boolean;
  isMine: boolean;
  baseCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const income = transaction.direction === "IN";
  const foreign = transaction.currencyOriginal !== baseCurrency;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${income ? "bg-emerald-50 text-emerald-600" : "bg-surface-2 text-muted"}`}
          aria-hidden
        >
          {income ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/ledger/${transaction.id}`} className="truncate text-sm font-medium hover:underline">
              {transaction.name}
            </Link>
            {transaction.attachments > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-xs text-subtle" title={`${transaction.attachments} attached`}>
                <Paperclip className="size-3" />
                {transaction.attachments}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted">
            {new Date(transaction.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
            {transaction.clientName}
            {transaction.categoryName && ` · ${transaction.categoryName}`}
            {transaction.vendorName && ` · ${transaction.vendorName}`}
          </p>
        </div>

        <div className="text-right">
          <p className={`text-sm font-medium tabular-nums ${income ? "text-emerald-600" : ""}`}>
            {income ? "+" : "−"}
            {formatMoney(BigInt(transaction.amountBase), baseCurrency).replace("−", "")}
          </p>
          {foreign && (
            <p className="text-xs text-subtle tabular-nums">
              {formatMoney(BigInt(transaction.amountOriginal), transaction.currencyOriginal)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {transaction.paymentStatus !== "Paid" && (
            <Badge tone={transaction.paymentStatus === "Overdue" ? "red" : "orange"}>{transaction.paymentStatus}</Badge>
          )}
          <Badge tone={stateTone(transaction.approvalState)}>{transaction.approvalState}</Badge>
          {/* Without this, a row that arrived settled from a spreadsheet reads
              exactly like one a person looked at and approved. */}
          {transaction.approvalInferred && (
            <Badge tone="grey" >
              <span title="Imported already approved. Nobody approved it here.">inferred</span>
            </Badge>
          )}
        </div>

        {canApprove && transaction.approvalState === "Submitted" && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              loading={pending}
              title="Approve"
              aria-label={`Approve ${transaction.ref}`}
              className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await decideTransaction({ id: transaction.id, decision: "Approved" });
                  if (result.ok) router.refresh();
                  else setError(result.error);
                })
              }
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Reject"
              aria-label={`Reject ${transaction.ref}`}
              className="text-[var(--red)] hover:bg-rose-50 hover:text-[var(--red)]"
              onClick={() => setRejecting(!rejecting)}
            >
              <X />
            </Button>
          </div>
        )}

        {isMine && (transaction.approvalState === "Draft" || transaction.approvalState === "Rejected") && (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await submitTransaction({ id: transaction.id });
                if (result.ok) router.refresh();
                else setError(result.error);
              })
            }
          >
            Submit
          </Button>
        )}
      </div>

      {rejecting && (
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await decideTransaction({
                id: transaction.id,
                decision: "Rejected",
                reason: String(formData.get("reason") ?? ""),
              });
              if (result.ok) {
                setRejecting(false);
                router.refresh();
              } else setError(result.error);
            })
          }
          className="mt-2 flex flex-wrap items-center gap-2 pl-10"
        >
          <input
            name="reason"
            required
            autoFocus
            placeholder="What needs fixing? They have to know."
            className="h-8 min-w-48 flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
          <Button type="submit" size="sm" variant="danger" loading={pending}>
            Reject
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      )}

      {error && <p className="mt-2 pl-10 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}

function stateTone(state: string): Tone {
  return state === "Approved" ? "green" : state === "Submitted" ? "orange" : state === "Rejected" ? "red" : "grey";
}
