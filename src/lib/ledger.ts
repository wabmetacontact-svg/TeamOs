import "server-only";
import { format } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { monthRange } from "./dates";
import { SALARY_CATEGORY } from "./constants";

/**
 * The ledger is the single source of truth for money. Salaries and client
 * payments write here; nothing keeps its own copy of an amount.
 */

/** TX-20260920-001 — readable, sortable, unique per day. */
export async function nextRef(date: Date): Promise<string> {
  const day = format(date, "yyyyMMdd");
  const prefix = `TX-${day}-`;
  const last = await db.transaction.findFirst({
    where: { ref: { startsWith: prefix } },
    orderBy: { ref: "desc" },
    select: { ref: true },
  });
  const seq = last ? Number(last.ref.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function getSalaryCategoryId(): Promise<string> {
  const existing = await db.category.findFirst({ where: { name: SALARY_CATEGORY, kind: "EXPENSE" } });
  if (existing) return existing.id;
  const created = await db.category.create({ data: { name: SALARY_CATEGORY, kind: "EXPENSE", color: "violet" } });
  return created.id;
}

/**
 * Keeps the ledger in step with a salary record (PRD: salary → expense, once).
 * Paid / Partially Paid create or update one expense; anything else removes it,
 * so a salary can never be double counted or left behind after a correction.
 */
export async function syncSalaryTransaction(salaryId: string, actorId: string): Promise<void> {
  const salary = await db.salary.findUnique({ where: { id: salaryId } });
  if (!salary) return;

  const shouldExist = salary.status === "Paid" || salary.status === "Partially Paid";
  const amount = salary.status === "Paid" ? salary.amount : salary.amountPaid;

  if (!shouldExist || amount <= 0) {
    if (salary.transactionId) {
      await db.salary.update({ where: { id: salary.id }, data: { transactionId: null } });
      await db.transaction.delete({ where: { id: salary.transactionId } }).catch(() => {});
    }
    return;
  }

  const date = salary.paymentDate ?? monthRange(salary.month).end;
  const data = {
    type: "EXPENSE",
    date,
    categoryId: await getSalaryCategoryId(),
    name: salary.employeeName,
    amount,
    status: "Paid",
    notes: salary.notes ?? `${salary.employeeName} — salary for ${salary.month}`,
  };

  if (salary.transactionId) {
    const exists = await db.transaction.findUnique({ where: { id: salary.transactionId }, select: { id: true } });
    if (exists) {
      await db.transaction.update({ where: { id: salary.transactionId }, data });
      return;
    }
  }

  const created = await db.transaction.create({
    data: { ...data, ref: await nextRef(date), createdById: actorId },
  });
  await db.salary.update({ where: { id: salary.id }, data: { transactionId: created.id } });
}

export type MonthTotals = {
  income: number;
  expense: number;
  net: number;
  pendingIncome: number;
  salaryPaid: number;
  count: number;
};

/** Everything the dashboard shows, from the ledger alone. */
export async function monthTotals(month: string): Promise<MonthTotals> {
  const { start, end } = monthRange(month);
  const rows = await db.transaction.groupBy({
    by: ["type", "status"],
    where: { date: { gte: start, lte: end } },
    _sum: { amount: true },
    _count: true,
  });

  const sum = (type: string, statuses?: string[]) =>
    rows
      .filter((r) => r.type === type && (!statuses || statuses.includes(r.status)))
      .reduce((s, r) => s + (r._sum.amount ?? 0), 0);

  const salaryCategory = await db.category.findFirst({ where: { name: SALARY_CATEGORY }, select: { id: true } });
  const salaryPaid = salaryCategory
    ? (
        await db.transaction.aggregate({
          where: { date: { gte: start, lte: end }, type: "EXPENSE", categoryId: salaryCategory.id },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0
    : 0;

  const income = sum("INCOME", ["Received", "Paid"]);
  const expense = sum("EXPENSE");

  return {
    income,
    expense,
    net: income - expense,
    pendingIncome: sum("INCOME", ["Pending"]),
    salaryPaid,
    count: rows.reduce((s, r) => s + r._count, 0),
  };
}

/** Spend or income grouped by a dimension, biggest first. */
export async function breakdown(
  where: Prisma.TransactionWhereInput,
  by: "categoryId" | "clientId" | "name",
): Promise<{ id: string; label: string; amount: number; count: number }[]> {
  const rows = await db.transaction.groupBy({ by: [by], where, _sum: { amount: true }, _count: true });
  const ids = rows.map((r) => r[by]).filter((v): v is string => !!v);

  const names = new Map<string, string>();
  if (by === "categoryId" && ids.length) {
    (await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).forEach((c) =>
      names.set(c.id, c.name),
    );
  } else if (by === "clientId" && ids.length) {
    (await db.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).forEach((c) =>
      names.set(c.id, c.name),
    );
  }

  return rows
    .map((r) => {
      const key = r[by];
      return {
        id: key ?? "none",
        label: by === "name" ? (key ?? "—") : key ? (names.get(key) ?? "Unknown") : "Uncategorised",
        amount: r._sum.amount ?? 0,
        count: r._count,
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Received vs outstanding for one client, straight from the ledger. */
export async function clientFinancials(clientId: string) {
  const [received, pending, last] = await Promise.all([
    db.transaction.aggregate({
      where: { clientId, type: "INCOME", status: { in: ["Received", "Paid"] } },
      _sum: { amount: true },
    }),
    db.transaction.aggregate({ where: { clientId, type: "INCOME", status: "Pending" }, _sum: { amount: true } }),
    db.transaction.findFirst({
      where: { clientId, type: "INCOME", status: { in: ["Received", "Paid"] } },
      orderBy: { date: "desc" },
      select: { date: true, amount: true },
    }),
  ]);
  return {
    received: received._sum.amount ?? 0,
    pending: pending._sum.amount ?? 0,
    lastPaymentDate: last?.date ?? null,
    lastPaymentAmount: last?.amount ?? 0,
  };
}
