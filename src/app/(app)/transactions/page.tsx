import type { Metadata } from "next";
import { requireManagerPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, monthLabel, monthRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getLedgerOptions, ledgerInclude, toLedgerRow } from "@/lib/queries";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { MonthPicker } from "@/components/app/month-picker";
import { TransactionList } from "@/components/app/transaction-list";
import { AddExpenseButton, AddIncomeButton } from "@/components/app/transaction-form";
import { ExportButton } from "@/components/app/export-button";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  await requireManagerPage();
  const { m } = await searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const { start, end } = monthRange(month);

  const [transactions, options] = await Promise.all([
    db.transaction.findMany({
      where: { date: { gte: start, lte: end } },
      include: ledgerInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    getLedgerOptions(),
  ]);

  const rows = transactions.map(toLedgerRow);
  const income = rows.filter((r) => r.type === "INCOME" && r.status !== "Pending").reduce((s, r) => s + r.amount, 0);
  const expense = rows.filter((r) => r.type === "EXPENSE").reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="One ledger for every rupee in and out."
        actions={
          <>
            <MonthPicker month={month} />
            <ExportButton type="transactions" month={month} />
            <AddIncomeButton options={options} />
            <AddExpenseButton options={options} />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Income" value={formatMoney(income)} tone="green" />
        <Kpi label="Expenses" value={formatMoney(expense)} tone="red" />
        <Kpi label="Net" value={formatMoney(income - expense)} tone="blue" />
        <Kpi label="Entries" value={rows.length} sub={monthLabel(month)} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${monthLabel(month)} ledger`} description="Click any row to see the full transaction." />
        <TransactionList rows={rows} options={options} />
      </Card>
    </>
  );
}
