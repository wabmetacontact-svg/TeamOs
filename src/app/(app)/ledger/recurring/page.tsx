import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Repeat } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { can, clientIdScope, clientScope } from "@/lib/scope";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { RecurringList } from "./recurring-list";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const { user, scope } = await requireScope();
  if (!can(scope, "expense:view")) notFound();

  const db = tenantDb(user.tenantId);
  const [rules, clients, categories] = await Promise.all([
    db.recurringSpend.findMany({
      where: { ...clientScope(scope) },
      include: {
        client: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }],
    }),
    db.client.findMany({
      where: { ...clientIdScope(scope), deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, direction: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const active = rules.filter((r) => r.active);
  const monthly = active.reduce((sum, r) => sum + (r.direction === "OUT" ? r.amount : 0n), 0n);

  return (
    <>
      <Link href="/ledger" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Ledger
      </Link>

      <PageHeader
        title="Recurring"
        description="Rules that produce a draft each month, not an approved entry. A subscription whose price changed, or one cancelled last month, would otherwise keep appearing at the old figure and nobody would catch it until the year-end."
      />

      {rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat />}
            title="No recurring rules"
            description="Rent, subscriptions, retainers — anything that arrives on the same day every month."
            action={
              can(scope, "expense:create") ? (
                <RecurringList
                  rules={[]}
                  clients={clients}
                  categories={categories}
                  baseCurrency={user.baseCurrency}
                  canEdit
                  monthlyTotal="0"
                  startOpen
                />
              ) : undefined
            }
          />
        </Card>
      ) : (
        <RecurringList
          rules={rules.map((r) => ({
            id: r.id,
            name: r.name,
            clientId: r.clientId,
            clientName: r.client.name,
            categoryId: r.categoryId,
            categoryName: r.category?.name ?? null,
            direction: r.direction as "IN" | "OUT",
            amount: r.amount.toString(),
            currency: r.currency,
            dayOfMonth: r.dayOfMonth,
            nextRunAt: r.nextRunAt.toISOString(),
            active: r.active,
          }))}
          clients={clients}
          categories={categories}
          baseCurrency={user.baseCurrency}
          canEdit={can(scope, "expense:edit")}
          monthlyTotal={monthly.toString()}
        />
      )}
    </>
  );
}
