import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCheck } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { pendingApprovals } from "@/lib/transactions";
import { can } from "@/lib/scope";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TransactionRow } from "../transaction-row";

export const metadata: Metadata = { title: "Approvals" };

/**
 * Everything waiting on a decision, oldest first.
 *
 * Oldest first because the cost of an approval queue is the person who
 * submitted the thing waiting on it, and the one who has waited longest is the
 * one to clear.
 */
export default async function ApprovalsPage() {
  const { user, scope } = await requireScope();
  if (!can(scope, "expense:approve")) notFound();

  const waiting = await pendingApprovals(scope);
  const total = waiting.reduce((sum, t) => sum + (t.direction === "OUT" ? t.amountBase : 0n), 0n);

  // An absolute date rather than "waited 3 days": it is pure, and it does not
  // go stale if this page sits open.
  const oldest = waiting[0]?.submittedAt;

  return (
    <>
      <Link href="/ledger" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Ledger
      </Link>

      <PageHeader
        title="Waiting for you"
        description={
          waiting.length === 0
            ? "Nothing is queued."
            : `${waiting.length} ${waiting.length === 1 ? "entry" : "entries"} · ${formatMoney(total, user.baseCurrency)} of spend${oldest ? ` · oldest submitted ${oldest.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}`
        }
      />

      {waiting.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCheck />}
            title="Nothing waiting"
            description="Every submission has been decided. The people who sent them are not blocked on you."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {waiting.map((t) => (
              <TransactionRow
                key={t.id}
                canApprove
                isMine={t.createdById === user.id}
                baseCurrency={user.baseCurrency}
                transaction={{
                  id: t.id,
                  ref: t.ref,
                  name: t.name,
                  direction: t.direction,
                  date: t.date.toISOString(),
                  clientName: t.client.name,
                  categoryName: t.category ? [t.category.parent?.name, t.category.name].filter(Boolean).join(" · ") : null,
                  vendorName: t.vendor?.name ?? null,
                  amountBase: t.amountBase.toString(),
                  amountOriginal: t.amountOriginal.toString(),
                  currencyOriginal: t.currencyOriginal,
                  approvalState: t.approvalState,
                  paymentStatus: t.paymentStatus,
                  attachments: t._count.attachments,
                  createdBy: t.createdBy.name,
                }}
              />
            ))}
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted">
        Rejecting asks for a reason, because the person who entered it has to know what to fix. Approving an entry you
        submitted yourself is possible and recorded — the audit trail shows who decided, not just that somebody did.
      </p>
    </>
  );
}
