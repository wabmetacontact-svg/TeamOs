import "server-only";
import { cache } from "react";
import { db } from "./db";
import { toDateInput } from "./dates";
import type { LedgerOptions } from "@/components/app/transaction-form";
import type { LedgerRow } from "@/components/app/transaction-list";

/** Dropdown data shared by every money form. */
export const getLedgerOptions = cache(async (): Promise<LedgerOptions> => {
  const [categories, clients, payees] = await Promise.all([
    db.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.transaction.findMany({ distinct: ["name"], select: { name: true }, orderBy: { name: "asc" }, take: 100 }),
  ]);

  return {
    expenseCategories: categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name })),
    incomeSources: categories.filter((c) => c.kind === "INCOME").map((c) => ({ id: c.id, name: c.name })),
    clients,
    payees: payees.map((p) => p.name),
    today: toDateInput(new Date()),
  };
});

export const ledgerInclude = {
  category: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  salary: { select: { id: true } },
};

type LedgerRecord = {
  id: string;
  ref: string;
  type: string;
  date: Date;
  categoryId: string | null;
  category: { name: string } | null;
  name: string;
  clientId: string | null;
  client: { name: string } | null;
  usdt: number | null;
  rate: number | null;
  amount: number;
  status: string;
  notes: string | null;
  salary: { id: string } | null;
};

/** Prisma row → the plain shape the client list expects. */
export function toLedgerRow(tx: LedgerRecord): LedgerRow {
  return {
    id: tx.id,
    ref: tx.ref,
    type: tx.type === "INCOME" ? "INCOME" : "EXPENSE",
    date: tx.date.toISOString(),
    categoryId: tx.categoryId,
    categoryName: tx.category?.name ?? null,
    name: tx.name,
    clientId: tx.clientId,
    clientName: tx.client?.name ?? null,
    usdt: tx.usdt,
    rate: tx.rate,
    amount: tx.amount,
    status: tx.status,
    notes: tx.notes,
    fromSalary: !!tx.salary,
  };
}
