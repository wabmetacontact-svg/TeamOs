"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager } from "@/lib/auth";
import { PAYMENT_STATUSES } from "@/lib/constants";
import { fromDateInput, startOfDay } from "@/lib/dates";
import { nextRef } from "@/lib/ledger";
import { toPaise, usdtToPaise } from "@/lib/money";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const schema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  date: dateInput,
  categoryId: z.string().optional(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  clientId: z.string().optional(),
  /** Income can arrive in USDT; the rupee value is always derived here. */
  usdt: z.string().optional(),
  rate: z.string().optional(),
  amount: z.string().optional(),
  status: z.enum(PAYMENT_STATUSES),
  notes: z.string().trim().max(1000).optional(),
});

export type TransactionInput = z.input<typeof schema>;

function done() {
  revalidatePath("/", "layout");
}

/** USDT × rate wins when both are given, so the two can never disagree. */
function resolveAmount(input: z.output<typeof schema>) {
  const usdt = input.usdt ? Number(input.usdt) : null;
  const rate = input.rate ? Number(input.rate) : null;

  if (usdt && rate) {
    if (usdt <= 0 || rate <= 0) throw new UserError("USDT amount and rate must be greater than zero.");
    return { usdt, rate, amount: usdtToPaise(usdt, rate) };
  }
  const amount = toPaise(input.amount ?? "");
  if (amount <= 0) throw new UserError("Amount must be greater than zero.");
  return { usdt: usdt ?? null, rate: rate ?? null, amount };
}

async function validateRefs(input: z.output<typeof schema>) {
  if (input.categoryId) {
    const category = await db.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new UserError("Please select a valid category.");
  }
  if (input.clientId) {
    const client = await db.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new UserError("Please select a valid client.");
  }
}

export async function createTransaction(raw: TransactionInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireManager();
    const input = schema.parse(raw);
    await validateRefs(input);
    const { usdt, rate, amount } = resolveAmount(input);
    const date = startOfDay(fromDateInput(input.date));

    const tx = await db.transaction.create({
      data: {
        ref: await nextRef(date),
        type: input.type,
        date,
        categoryId: input.categoryId || null,
        name: input.name,
        clientId: input.clientId || null,
        usdt,
        rate,
        amount,
        status: input.status,
        notes: input.notes || null,
        createdById: user.id,
      },
    });
    done();
    return { ok: true, data: { id: tx.id }, message: input.type === "INCOME" ? "Income recorded" : "Expense recorded" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateTransaction(id: string, raw: TransactionInput): Promise<ActionResult> {
  try {
    await requireManager();
    const existing = await db.transaction.findUnique({ where: { id }, include: { salary: true } });
    if (!existing) throw new UserError("Transaction could not be found.");
    if (existing.salary) {
      throw new UserError("This expense comes from a salary. Edit it in Salaries so both stay in step.");
    }

    const input = schema.parse(raw);
    await validateRefs(input);
    const { usdt, rate, amount } = resolveAmount(input);

    await db.transaction.update({
      where: { id },
      data: {
        type: input.type,
        date: startOfDay(fromDateInput(input.date)),
        categoryId: input.categoryId || null,
        name: input.name,
        clientId: input.clientId || null,
        usdt,
        rate,
        amount,
        status: input.status,
        notes: input.notes || null,
      },
    });
    done();
    return { ok: true, message: "Transaction updated" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  try {
    await requireManager();
    const existing = await db.transaction.findUnique({ where: { id }, include: { salary: true } });
    if (!existing) throw new UserError("Transaction could not be found.");
    if (existing.salary) {
      throw new UserError("This expense comes from a salary. Change the salary status instead.");
    }
    await db.transaction.delete({ where: { id } });
    done();
    return { ok: true, message: "Transaction deleted" };
  } catch (err) {
    return toActionError(err);
  }
}
