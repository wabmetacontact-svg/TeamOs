import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Scale } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { differences, inferredApprovals, progress } from "@/lib/reconciliation";
import { formatMoney } from "@/lib/money";
import { can, clientIdScope } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { RecordForm } from "./record-form";
import { DifferenceRow } from "./difference-row";

export const metadata: Metadata = { title: "Reconcile" };

/**
 * Checking the platform against the sheets it replaced.
 *
 * The one screen in the application whose job is to prove the others wrong.
 * Everything else here trusts the ledger; this compares it against a number
 * somebody read off the source by hand, and shows the gap to the paisa.
 */
export default async function ReconcilePage({ searchParams }: PageProps<"/ledger/reconcile">) {
  const { user, scope } = await requireScope();
  if (!can(scope, "expense:view")) notFound();

  const params = await searchParams;
  const unresolvedOnly = params.open === "1";

  const [rows, state, inferred, clients] = await Promise.all([
    differences(scope, { unresolvedOnly }),
    progress(scope),
    inferredApprovals(scope),
    tenantDb(user.tenantId).client.findMany({
      where: { ...clientIdScope(scope), deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const mismatched = rows.filter((r) => !r.matches && !r.resolvedAt).length;
  const currency = user.baseCurrency;

  return (
    <>
      <Link href="/ledger" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Ledger
      </Link>

      <PageHeader
        title="Reconcile"
        description="Type in what each source sheet says a client-month came to, and see the difference against the ledger to the paisa. A month is settled when somebody says so — not when the numbers happen to agree."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Recorded" value={String(state.recorded)} hint="client-months with a sheet figure" />
        <Stat
          label="Settled"
          value={`${state.resolved} of ${state.recorded}`}
          tone={state.recorded > 0 && state.resolved === state.recorded ? "green" : undefined}
        />
        <Stat
          label="Differ, unsettled"
          value={String(mismatched)}
          tone={mismatched > 0 ? "red" : undefined}
        />
        <Stat
          label="Never checked"
          value={String(state.unchecked)}
          hint={`${state.uncheckedRows} entries imported, compared against nothing`}
          tone={state.unchecked > 0 ? "orange" : undefined}
        />
      </div>

      {inferred.count > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          <p className="font-medium">
            {inferred.count} {inferred.count === 1 ? "entry" : "entries"} ·{" "}
            {formatMoney(inferred.value, currency)} were imported already approved
          </p>
          <p className="mt-0.5 text-muted">
            Nobody approved these here — they arrived settled from a sheet. They count toward every total, and they
            are flagged so they never read as a decision somebody made. Marked{" "}
            <Badge tone="grey">inferred</Badge> wherever they appear.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Client-months"
            description={unresolvedOnly ? "Unsettled only" : "Newest month first"}
            action={
              <Link
                href={unresolvedOnly ? "/ledger/reconcile" : "/ledger/reconcile?open=1"}
                className="text-xs font-medium text-brand hover:underline"
              >
                {unresolvedOnly ? "Show all" : "Unsettled only"}
              </Link>
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              icon={unresolvedOnly ? <CheckCircle2 /> : <Scale />}
              title={unresolvedOnly ? "Nothing unsettled" : "Nothing recorded yet"}
              description={
                unresolvedOnly
                  ? "Every recorded month has been signed off."
                  : "Record what the sheet says for a client-month on the right, and it appears here with the difference."
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <DifferenceRow
                  key={`${row.clientId}:${row.month}`}
                  currency={currency}
                  canResolve={can(scope, "expense:approve")}
                  row={{
                    clientId: row.clientId,
                    clientName: row.clientName,
                    month: row.month,
                    expectedIncome: row.expectedIncome.toString(),
                    expectedSpend: row.expectedSpend.toString(),
                    actualIncome: row.actualIncome.toString(),
                    actualSpend: row.actualSpend.toString(),
                    incomeDelta: row.incomeDelta.toString(),
                    spendDelta: row.spendDelta.toString(),
                    unapproved: row.unapproved,
                    unapprovedValue: row.unapprovedValue.toString(),
                    entries: row.entries,
                    matches: row.matches,
                    resolvedAt: row.resolvedAt?.toISOString() ?? null,
                    resolvedBy: row.resolvedBy,
                    note: row.note,
                    source: row.source,
                  }}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4">
          {can(scope, "expense:edit") && (
            <Card>
              <CardHeader
                title="Record a sheet figure"
                description="Read it off the source by hand. A number extracted by the same code that did the import would agree with itself and prove nothing."
              />
              <CardBody>
                <RecordForm clients={clients} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="text-xs text-muted">
              <p className="mb-1 font-medium text-fg">What finishes a cutover</p>
              <p>
                Every month with data has a sheet figure, every figure is settled, and one full month has run in both
                places with this one as the system of record. Only then do the sheets go read-only.
              </p>
              <p className="mt-1.5">
                That last part is a process, not a feature — somebody has to run both for a month. Nothing here can do
                it for you.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "green" | "red" | "orange";
}) {
  const color =
    tone === "green" ? "text-emerald-600" : tone === "red" ? "text-[var(--red)]" : tone === "orange" ? "text-orange-600" : "";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}
