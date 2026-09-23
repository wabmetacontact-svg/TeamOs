"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager } from "@/lib/auth";
import { CLIENT_STATUSES, PAYMENT_STATUSES } from "@/lib/constants";
import { fromDateInput, startOfDay } from "@/lib/dates";
import { nextRef } from "@/lib/ledger";
import { toPaise, usdtToPaise } from "@/lib/money";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

const clientSchema = z.object({
  name: z.string().trim().min(2, "Client name is required.").max(80),
  company: z.string().trim().max(80).optional(),
  contactPerson: z.string().trim().max(80).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).optional(),
  phone: z.string().trim().max(30).optional(),
  project: z.string().trim().max(120).optional(),
  contractValue: z.string().optional(),
  paymentTerms: z.string().trim().max(60).optional(),
  status: z.enum(CLIENT_STATUSES),
  notes: z.string().trim().max(1000).optional(),
});

export type ClientInput = z.input<typeof clientSchema>;

function done() {
  revalidatePath("/", "layout");
}

export async function saveClient(id: string | null, raw: ClientInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requireManager();
    const input = clientSchema.parse(raw);
    const data = {
      name: input.name,
      company: input.company || null,
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
      project: input.project || null,
      contractValue: input.contractValue ? toPaise(input.contractValue) : null,
      paymentTerms: input.paymentTerms || null,
      status: input.status,
      notes: input.notes || null,
    };

    const client = id ? await db.client.update({ where: { id }, data }) : await db.client.create({ data });
    done();
    return { ok: true, data: { id: client.id }, message: id ? "Client updated" : "Client added" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteClient(id: string): Promise<ActionResult> {
  try {
    await requireManager();
    const payments = await db.transaction.count({ where: { clientId: id } });
    if (payments > 0) {
      throw new UserError(`This client has ${payments} payment(s) in the ledger. Mark them inactive instead of deleting.`);
    }
    await db.client.delete({ where: { id } });
    done();
    return { ok: true, message: "Client deleted" };
  } catch (err) {
    return toActionError(err);
  }
}

const paymentSchema = z.object({
  clientId: z.string().min(1, "Please select a client."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  currency: z.enum(["INR", "USDT"]),
  amount: z.string().optional(),
  usdt: z.string().optional(),
  rate: z.string().optional(),
  status: z.enum(PAYMENT_STATUSES),
  notes: z.string().trim().max(500).optional(),
});

export type ClientPaymentInput = z.input<typeof paymentSchema>;

/**
 * A recorded client payment IS an income transaction — there is no separate
 * client money table to keep in sync.
 */
export async function recordClientPayment(raw: ClientPaymentInput): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const input = paymentSchema.parse(raw);

    const client = await db.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new UserError("Please select a valid client.");

    let usdt: number | null = null;
    let rate: number | null = null;
    let amount: number;

    if (input.currency === "USDT") {
      usdt = Number(input.usdt);
      rate = Number(input.rate);
      if (!usdt || usdt <= 0) throw new UserError("Enter the USDT amount.");
      if (!rate || rate <= 0) throw new UserError("Enter the USDT → INR rate.");
      amount = usdtToPaise(usdt, rate);
    } else {
      amount = toPaise(input.amount ?? "");
      if (amount <= 0) throw new UserError("Amount must be greater than zero.");
    }

    const date = startOfDay(fromDateInput(input.date));
    const source = await db.category.findFirst({ where: { name: client.name, kind: "INCOME" } });

    await db.transaction.create({
      data: {
        ref: await nextRef(date),
        type: "INCOME",
        date,
        name: client.name,
        clientId: client.id,
        categoryId: source?.id ?? null,
        usdt,
        rate,
        amount,
        status: input.status,
        notes: input.notes || null,
        createdById: user.id,
      },
    });

    done();
    return { ok: true, message: input.status === "Pending" ? "Payment recorded as pending" : "Payment recorded" };
  } catch (err) {
    return toActionError(err);
  }
}
