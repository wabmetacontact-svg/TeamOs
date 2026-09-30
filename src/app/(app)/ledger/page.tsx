import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, Download, Inbox, Receipt, Repeat, Scale, Upload } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { bookMonthOf, formatBookMonth, formatMoney, isBookMonth, nextBookMonth, previousBookMonth } from "@/lib/money";
import { categoryTotals, listTransactions, monthTotals } from "@/lib/transactions";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { LedgerFilters } from "./ledger-filters";
import { NewEntryButton } from "./new-entry-button";
import { TransactionRow } from "./transaction-row";

export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v ? v : undefined;
  };

  const month = isBookMonth(one("month") ?? "") ? one("month")! : bookMonthOf(new Date());
  const filters = {
    bookMonth: month,
    clientId: one("client"),
    categoryId: one("category"),
    direction: one("direction"),
    approvalState: one("state"),
    paymentStatus: one("payment"),
    q: one("q"),
    mineOnly: one("mine") === "1",
  };

  const db = tenantDb(user.tenantId);
  const [transactions, totals, byCategory, clients, categories, vendors, pending] = await Promise.all([
    listTransactions(scope, filters),
    // Approved only — this is the figure that can be quoted.
    monthTotals(scope, { bookMonth: month, clientId: filters.clientId }),
    categoryTotals(scope, { bookMonth: month, clientId: filters.clientId, direction: "OUT" }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, direction: true, parent: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.vendor.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    can(scope, "expense:approve")
      ? db.transaction.count({
          where: { approvalState: "Submitted", deletedAt: null, ...(scope.allClients ? {} : { clientId: { in: [...scope.clientIds] } }) },
        })
      : Promise.resolve(0),
  ]);

  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { month, client: filters.clientId, category: filters.categoryId, direction: filters.direction, state: filters.approvalState, payment: filters.paymentStatus, q: filters.q, mine: filters.mineOnly ? "1" : undefined, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return next.toString();
  };

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Money in and money out, in one place. Totals are approved entries only — a figure that counts what nobody signed off is not a figure you can take to a client."
        actions={
          <>
            {can(scope, "expense:view") && (
              <Button variant="secondary" asChild>
                <Link href="/ledger/months">
                  <CalendarCheck />
                  Months
                </Link>
              </Button>
            )}
            {can(scope, "expense:view") && (
              <Button variant="secondary" asChild>
                <Link href="/ledger/reconcile">
                  <Scale />
                  Reconcile
                </Link>
              </Button>
            )}
            {can(scope, "expense:view") && (
              <Button variant="secondary" asChild>
                <Link href="/ledger/recurring">
                  <Repeat />
                  Recurring
                </Link>
              </Button>
            )}
            {can(scope, "expense:export") && (
              <Button variant="secondary" asChild>
                <a href={`/api/ledger/export?month=${month}${filters.clientId ? `&client=${filters.clientId}` : ""}`}>
                  <Download />
                  Export
                </a>
              </Button>
            )}
            {can(scope, "expense:create") && (
              <Button variant="secondary" asChild>
                <Link href="/ledger/import">
                  <Upload />
                  Import
                </Link>
              </Button>
            )}
            {can(scope, "expense:create") && (
              <NewEntryButton clients={clients} categories={categories} vendors={vendors} defaultMonth={month} baseCurrency={user.baseCurrency} />
            )}
          </>
        }
      />

      {pending > 0 && (
        <Link
          href="/ledger/approvals"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 transition-colors hover:bg-orange-100"
        >
          <Inbox className="size-4 shrink-0" />
          <span className="font-medium">
            {pending} {pending === 1 ? "entry is" : "entries are"} waiting for your decision
          </span>
          <span className="ml-auto text-xs">Review →</span>
        </Link>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/ledger?${query({ month: previousBookMonth(month) })}`}>←</Link>
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{formatBookMonth(month)}</span>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/ledger?${query({ month: nextBookMonth(month) })}`}>→</Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Total icon={<ArrowDownLeft className="size-3.5" />} label="In" value={formatMoney(totals.income, user.baseCurrency)} tone="green" />
          <Total icon={<ArrowUpRight className="size-3.5" />} label="Out" value={formatMoney(totals.spend, user.baseCurrency)} tone="red" />
          <Total
            label="Net"
            value={formatMoney(totals.net, user.baseCurrency)}
            tone={totals.net >= 0n ? "green" : "red"}
            strong
          />
        </div>
      </div>

      <LedgerFilters clients={clients} categories={categories} month={month} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          {transactions.length === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title="Nothing in this month"
              description={
                filters.q || filters.clientId || filters.categoryId
                  ? "Try clearing the filters, or a different month."
                  : "Add an entry, or import a sheet you already keep."
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  canApprove={can(scope, "expense:approve")}
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
                    approvalInferred: t.approvalInferred,
                    paymentStatus: t.paymentStatus,
                    attachments: t._count.attachments,
                    createdBy: t.createdBy.name,
                  }}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Where it went" description="Approved spend, this month" />
            <CardBody className="grid gap-2">
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted">Nothing approved yet.</p>
              ) : (
                byCategory.slice(0, 10).map((row, i) => {
                  const share = totals.spend > 0n ? Number((row.total * 1000n) / totals.spend) / 10 : 0;
                  return (
                    <div key={row.category?.id ?? `none-${i}`}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{row.category?.name ?? "Uncategorised"}</span>
                        <span className="shrink-0 font-medium">{formatMoney(row.total, user.baseCurrency, { compact: true })}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(share, 1)}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="This month" description="Counted and uncounted" />
            <CardBody className="grid gap-2 text-sm">
              <Row label="Entries shown" value={String(transactions.length)} />
              <Row label="Approved" value={String(transactions.filter((t) => t.approvalState === "Approved").length)} />
              <Row label="Waiting" value={String(transactions.filter((t) => t.approvalState === "Submitted").length)} />
              <Row label="Drafts" value={String(transactions.filter((t) => t.approvalState === "Draft").length)} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Total({
  icon,
  label,
  value,
  tone,
  strong,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "red";
  strong?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="flex items-center gap-1 text-xs text-muted">
        {icon}
        {label}
      </span>
      <span className={`${strong ? "text-base font-semibold" : "font-medium"} ${tone === "green" ? "text-emerald-600" : "text-[var(--red)]"}`}>
        {value}
      </span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <Badge tone="grey">{value}</Badge>
    </div>
  );
}
