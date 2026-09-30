import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { bookMonthOf, previousBookMonth } from "@/lib/money";
import { bookMonthState, monthTotals } from "@/lib/transactions";
import { can, clientIdScope } from "@/lib/scope";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { MonthGrid } from "./month-grid";

export const metadata: Metadata = { title: "Book months" };

/** The last twelve months, newest first. */
function recentMonths(count = 12): string[] {
  const months: string[] = [];
  let month = bookMonthOf(new Date());
  for (let i = 0; i < count; i++) {
    months.push(month);
    month = previousBookMonth(month);
  }
  return months;
}

/**
 * Closing a month is what makes a number citable: once closed, nothing in it
 * moves, so a figure quoted in March still means the same thing in September.
 * This is the page where that decision gets made, per client.
 */
export default async function MonthsPage() {
  const { user, scope } = await requireScope();
  const months = recentMonths();

  const clients = await tenantDb(user.tenantId).client.findMany({
    where: { ...clientIdScope(scope), deletedAt: null, status: { not: "Archived" } },
    select: { id: true, name: true, brand: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const perClient = await Promise.all(
    clients.map(async (client) => {
      const [state, totals] = await Promise.all([
        bookMonthState(scope, client.id, months),
        monthTotals(scope, { clientId: client.id, fromMonth: months.at(-1), toMonth: months[0] }),
      ]);

      const byMonth = new Map<string, { income: bigint; spend: bigint }>();
      for (const row of totals.rows) {
        const entry = byMonth.get(row.bookMonth) ?? { income: 0n, spend: 0n };
        if (row.direction === "IN") entry.income += row.total;
        else entry.spend += row.total;
        byMonth.set(row.bookMonth, entry);
      }

      return {
        client,
        months: state.map((m) => ({
          ...m,
          closedAt: m.closedAt?.toISOString() ?? null,
          income: (byMonth.get(m.month)?.income ?? 0n).toString(),
          spend: (byMonth.get(m.month)?.spend ?? 0n).toString(),
        })),
      };
    }),
  );

  return (
    <>
      <Link href="/ledger" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Ledger
      </Link>

      <PageHeader
        title="Book months"
        description="Closing a month freezes it. The database refuses writes to a closed month — not only this application, so an import or a console cannot slip one past it either. Reopening is allowed and costs a written reason."
      />

      {clients.length === 0 ? (
        <Card>
          <EmptyState title="No clients" description="Months are closed per client, so there is nothing to close yet." />
        </Card>
      ) : (
        <div className="grid gap-4">
          {perClient.map(({ client, months: rows }) => (
            <MonthGrid
              key={client.id}
              clientId={client.id}
              clientName={client.name}
              brandName={client.brand.name}
              baseCurrency={user.baseCurrency}
              canClose={can(scope, "book_month:close")}
              canReopen={can(scope, "book_month:reopen")}
              months={rows}
            />
          ))}
        </div>
      )}
    </>
  );
}
