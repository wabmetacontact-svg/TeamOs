import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckSquare,
  Clock,
  Inbox,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { requireScope } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import { formatBookMonth, formatMoney, isBookMonth, nextBookMonth, previousBookMonth } from "@/lib/money";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;
  const requested = typeof params.month === "string" && isBookMonth(params.month) ? params.month : undefined;

  const data = await loadDashboard({
    scope,
    baseCurrency: user.baseCurrency,
    timeZone: user.timezone,
    month: requested,
  });

  const { money, tasks, pipeline, clients, approvals, month } = data;
  const currency = user.baseCurrency;

  return (
    <>
      <PageHeader
        title={`Hello ${user.name.split(" ")[0]}`}
        description={
          data.reach === "all"
            ? "Everything in the workspace."
            : data.reach === "scoped"
              ? `The ${scope.clientIds.length} ${scope.clientIds.length === 1 ? "client" : "clients"} you are assigned to. Somebody with wider access sees different totals — both are right.`
              : "Your own work."
        }
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard?month=${previousBookMonth(month)}`}>←</Link>
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{formatBookMonth(month)}</span>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard?month=${nextBookMonth(month)}`}>→</Link>
            </Button>
          </div>
        }
      />

      {approvals.waiting > 0 && can(scope, "expense:approve") && (
        <Link
          href="/ledger/approvals"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 transition-colors hover:bg-orange-100"
        >
          <Inbox className="size-4 shrink-0" />
          <span className="font-medium">
            {approvals.waiting} {approvals.waiting === 1 ? "entry" : "entries"} waiting ·{" "}
            {formatMoney(approvals.value, currency)}
          </span>
          <span className="ml-auto text-xs">Review →</span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<ArrowDownLeft className="size-4" />}
          label="Money in"
          value={formatMoney(money.income, currency, { compact: true })}
          change={percentChange(money.income, money.previousIncome)}
          goodWhenUp
          href={`/ledger?month=${month}&direction=IN`}
        />
        <Stat
          icon={<ArrowUpRight className="size-4" />}
          label="Money out"
          value={formatMoney(money.spend, currency, { compact: true })}
          change={percentChange(money.spend, money.previousSpend)}
          href={`/ledger?month=${month}&direction=OUT`}
        />
        <Stat
          icon={money.net >= 0n ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          label="Net"
          value={formatMoney(money.net, currency, { compact: true })}
          tone={money.net >= 0n ? "green" : "red"}
          href={`/ledger?month=${month}`}
        />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          label="Overdue tasks"
          value={String(tasks.overdue)}
          tone={tasks.overdue > 0 ? "red" : undefined}
          href="/tasks?view=all&overdue=1"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Where the money went"
              description={`${money.entries} approved ${money.entries === 1 ? "entry" : "entries"} in ${formatBookMonth(month)}`}
              action={money.unapproved > 0 ? <Badge tone="orange">{money.unapproved} not counted</Badge> : undefined}
            />
            <CardBody className="grid gap-2">
              {money.topCategories.length === 0 ? (
                <p className="text-sm text-muted">Nothing approved this month.</p>
              ) : (
                money.topCategories.map((row) => {
                  const share = money.spend > 0n ? Number((row.total * 1000n) / money.spend) / 10 : 0;
                  return (
                    <div key={row.name}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{row.name}</span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatMoney(row.total, currency, { compact: true })}
                        </span>
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
            <CardHeader
              title="By client"
              description={`${clients.active} active${clients.withoutEntries > 0 ? ` · ${clients.withoutEntries} with nothing recorded this month` : ""}`}
            />
            <CardBody className="grid gap-2 text-sm">
              {money.byClient.length === 0 ? (
                <p className="text-muted">Nothing recorded.</p>
              ) : (
                money.byClient.slice(0, 8).map((row) => (
                  <Link
                    key={row.clientId}
                    href={`/ledger?month=${month}&client=${row.clientId}`}
                    className="flex items-baseline justify-between gap-3 hover:underline"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-emerald-600">+{formatMoney(row.income, currency, { compact: true })}</span>
                      {" · "}
                      <span className="text-[var(--red)]">−{formatMoney(row.spend, currency, { compact: true })}</span>
                    </span>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          {tasks.byAssignee.length > 0 && (
            <Card>
              <CardHeader title="Who is carrying what" description="Open tasks, most overdue first" />
              <CardBody className="grid gap-2 text-sm">
                {tasks.byAssignee.slice(0, 8).map((row) => (
                  <div key={row.userId} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{row.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {row.open} open
                      {row.overdue > 0 && <span className="text-[var(--red)]"> · {row.overdue} overdue</span>}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Your work" />
            <CardBody className="grid gap-2 text-sm">
              <Row icon={<CheckSquare className="size-3.5" />} label="On you" value={String(tasks.mine)} href="/tasks" />
              <Row icon={<Clock className="size-3.5" />} label="Due today" value={String(tasks.dueToday)} href="/tasks" />
              <Row
                icon={<AlertTriangle className="size-3.5" />}
                label="Overdue"
                value={String(tasks.overdue)}
                href="/tasks?view=all&overdue=1"
              />
              <div className="mt-1 border-t border-border pt-2 text-xs text-muted">
                {tasks.completedThisMonth} completed this month
                {tasks.lateThisMonth > 0 && `, ${tasks.lateThisMonth} late`}
                {tasks.medianDaysLate != null &&
                  ` — typically ${tasks.medianDaysLate} ${tasks.medianDaysLate === 1 ? "day" : "days"} over`}
              </div>
            </CardBody>
          </Card>

          {pipeline.total > 0 && (
            <Card>
              <CardHeader
                title="Pipelines"
                description={`${pipeline.total} live · ${formatMoney(pipeline.value, currency, { compact: true })}`}
              />
              <CardBody className="grid gap-2 text-sm">
                {pipeline.byContext.map((row) => (
                  <Link
                    key={row.contextId}
                    href={`/pipelines?context=${row.contextId}`}
                    className="flex items-baseline justify-between gap-3 hover:underline"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {row.count}
                      {row.value > 0n && ` · ${formatMoney(row.value, currency, { compact: true })}`}
                    </span>
                  </Link>
                ))}

                {pipeline.stalest.length > 0 && (
                  <div className="mt-1 border-t border-border pt-2">
                    <p className="mb-1 text-xs text-muted">Nobody has touched these</p>
                    {pipeline.stalest.slice(0, 3).map((row) => (
                      <Link
                        key={row.id}
                        href="/pipelines"
                        className="flex items-baseline justify-between gap-3 text-xs hover:underline"
                      >
                        <span className="truncate">{row.personName}</span>
                        <span className="shrink-0 text-subtle">{row.days}d</span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Clients" />
            <CardBody className="grid gap-2 text-sm">
              {clients.byBrand.length === 0 ? (
                <Link href="/clients" className="flex items-center gap-1.5 text-brand hover:underline">
                  <Building2 className="size-3.5" />
                  Add your first client
                </Link>
              ) : (
                clients.byBrand.map((row) => (
                  <div key={row.brandId} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{row.name}</span>
                    <span className="tabular-nums text-muted">{row.count}</span>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted">
        As of{" "}
        {data.asOf.toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
          timeZone: user.timezone,
        })}
        . Figures count approved entries only, and reach only as far as you do — which is why two people can see
        different totals for the same month and both be right.
      </p>
    </>
  );
}

function percentChange(now: bigint, before: bigint): number | null {
  if (before === 0n) return null;
  return Math.round((Number(now - before) / Number(before)) * 100);
}

function Stat({
  icon,
  label,
  value,
  change,
  goodWhenUp,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: number | null;
  goodWhenUp?: boolean;
  tone?: "green" | "red";
  href: string;
}) {
  // Up is not automatically good: spend rising is the opposite.
  const good = change == null ? null : goodWhenUp ? change >= 0 : change <= 0;

  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${
          tone === "green" ? "text-emerald-600" : tone === "red" ? "text-[var(--red)]" : ""
        }`}
      >
        {value}
      </p>
      {change != null && (
        <p className={`mt-0.5 text-xs ${good ? "text-emerald-600" : "text-[var(--red)]"}`}>
          {change > 0 ? "+" : ""}
          {change}% on last month
        </p>
      )}
    </Link>
  );
}

function Row({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href: string }) {
  return (
    <Link href={href} className="flex items-baseline justify-between gap-3 hover:underline">
      <span className="flex items-center gap-1.5 text-muted">
        {icon}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </Link>
  );
}
