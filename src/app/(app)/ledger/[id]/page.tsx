import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatBookMonth, formatMoney } from "@/lib/money";
import { getTransaction, isMonthClosed } from "@/lib/transactions";
import { storageConfigured } from "@/lib/storage";
import { can, NotFoundError } from "@/lib/scope";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EntryEditor } from "./entry-editor";
import { AttachmentsPanel } from "./attachments-panel";
import { EntryHistory } from "./entry-history";

export async function generateMetadata({ params }: PageProps<"/ledger/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { scope } = await requireScope();
  try {
    const t = await getTransaction(scope, id);
    return { title: `${t.ref} · ${t.name}` };
  } catch {
    return { title: "Not found" };
  }
}

export default async function TransactionPage({ params }: PageProps<"/ledger/[id]">) {
  const { id } = await params;
  const { user, scope } = await requireScope();

  let transaction;
  try {
    transaction = await getTransaction(scope, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const db = tenantDb(user.tenantId);
  const [clients, categories, vendors, closed, history] = await Promise.all([
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, direction: true, parent: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.vendor.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    isMonthClosed(scope, transaction.clientId, transaction.bookMonth),
    db.auditEntry.findMany({
      where: { resourceType: "Transaction", resourceId: id },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const income = transaction.direction === "IN";
  const mayEdit = can(scope, "expense:edit") && !closed;

  return (
    <>
      <Link href={`/ledger?month=${transaction.bookMonth}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        {formatBookMonth(transaction.bookMonth)}
      </Link>

      <PageHeader
        title={transaction.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{transaction.ref}</code>
            <Badge tone={stateTone(transaction.approvalState)}>{transaction.approvalState}</Badge>
            {transaction.paymentStatus !== "Paid" && (
              <Badge tone={transaction.paymentStatus === "Overdue" ? "red" : "orange"}>{transaction.paymentStatus}</Badge>
            )}
            {closed && <Badge tone="grey">Month closed</Badge>}
            <span className={`text-base font-semibold ${income ? "text-emerald-600" : ""}`}>
              {income ? "+" : "−"}
              {formatMoney(transaction.amountBase, user.baseCurrency).replace("−", "")}
            </span>
            {transaction.currencyOriginal !== user.baseCurrency && (
              <span className="text-xs text-muted">
                {formatMoney(transaction.amountOriginal, transaction.currencyOriginal)} at{" "}
                {transaction.exchangeRate.toString()}
              </span>
            )}
          </span>
        }
      />

      {closed && (
        <p className="mb-4 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
          {formatBookMonth(transaction.bookMonth)} is closed for {transaction.client.name}, so nothing here can change.
          The database refuses it, not just this page. Reopen the month from{" "}
          <Link href="/ledger/months" className="font-medium text-brand hover:underline">
            Book months
          </Link>{" "}
          if it genuinely has to move.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Entry"
              description={
                mayEdit
                  ? "Changing the amount or the book month sends it back for approval"
                  : closed
                    ? "Frozen by the closed month"
                    : "You can read this but not change it"
              }
            />
            <CardBody>
              <EntryEditor
                canEdit={mayEdit}
                canDelete={can(scope, "expense:delete") && !closed}
                baseCurrency={user.baseCurrency}
                clients={clients}
                categories={categories}
                vendors={vendors}
                transaction={{
                  id: transaction.id,
                  clientId: transaction.clientId,
                  direction: transaction.direction as "IN" | "OUT",
                  name: transaction.name,
                  date: transaction.date.toISOString().slice(0, 10),
                  bookMonth: transaction.bookMonth,
                  amount: transaction.amountOriginal.toString(),
                  currency: transaction.currencyOriginal,
                  exchangeRate: transaction.exchangeRate.toString(),
                  categoryId: transaction.categoryId ?? "",
                  vendorId: transaction.vendorId ?? "",
                  paymentMethod: transaction.paymentMethod,
                  paymentStatus: transaction.paymentStatus,
                  description: transaction.description ?? "",
                  tags: transaction.tags.join(", "),
                  approvalState: transaction.approvalState,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="From the audit log, which nothing can edit" />
            <CardBody>
              <EntryHistory
                entries={history.map((h) => ({
                  id: h.id,
                  action: h.action,
                  actor: h.actor?.name ?? "Someone since removed",
                  createdAt: h.createdAt.toISOString(),
                  before: h.before,
                  after: h.after,
                }))}
                baseCurrency={user.baseCurrency}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Receipts" description={storageConfigured() ? "Uploaded straight to storage" : undefined} />
            <CardBody>
              <AttachmentsPanel
                transactionId={transaction.id}
                canEdit={mayEdit}
                storageReady={storageConfigured()}
                attachments={transaction.attachments.map((a) => ({
                  id: a.id,
                  filename: a.filename,
                  contentType: a.contentType,
                  sizeBytes: a.sizeBytes,
                  uploadedBy: a.uploadedBy.name,
                  createdAt: a.createdAt.toISOString(),
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Trail" />
            <CardBody className="grid gap-2 text-sm">
              <Row label="Client" value={transaction.client.name} />
              <Row label="Book month" value={formatBookMonth(transaction.bookMonth)} />
              <Row label="Entered by" value={transaction.createdBy.name} />
              {transaction.approvedBy && <Row label="Decided by" value={transaction.approvedBy.name} />}
              {transaction.approvedAt && (
                <Row
                  label="Decided"
                  value={transaction.approvedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                />
              )}
              {transaction.rejectionReason && (
                <p className="mt-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {transaction.rejectionReason}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function stateTone(state: string): Tone {
  return state === "Approved" ? "green" : state === "Submitted" ? "orange" : state === "Rejected" ? "red" : "grey";
}
