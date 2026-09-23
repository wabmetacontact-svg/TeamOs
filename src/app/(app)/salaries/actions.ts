"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager } from "@/lib/auth";
import { SALARY_STATUSES } from "@/lib/constants";
import { fromDateInput, startOfDay } from "@/lib/dates";
import { syncSalaryTransaction } from "@/lib/ledger";
import { toPaise } from "@/lib/money";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  employeeName: z.string().trim().min(2, "Employee name is required.").max(80),
  amount: z.string().min(1, "Monthly salary is required."),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a salary month"),
  paymentDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  amountPaid: z.string().optional(),
  status: z.enum(SALARY_STATUSES),
  notes: z.string().trim().max(500).optional(),
});

export type SalaryInput = z.input<typeof schema>;

function done() {
  revalidatePath("/", "layout");
}

/**
 * A salary row owns its expense in the ledger: marking it Paid creates the
 * expense, changing it back removes it. Nobody types the same payment twice.
 */
export async function saveSalary(id: string | null, raw: SalaryInput): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const input = schema.parse(raw);
    const amount = toPaise(input.amount);
    if (amount <= 0) throw new UserError("Monthly salary must be greater than zero.");

    let amountPaid = input.status === "Paid" ? amount : toPaise(input.amountPaid ?? "");
    if (input.status === "Pending") amountPaid = 0;
    if (input.status === "Partially Paid") {
      if (amountPaid <= 0) throw new UserError("Enter how much was actually paid.");
      if (amountPaid > amount) throw new UserError("Amount paid cannot be more than the salary.");
    }

    const paymentDate =
      input.paymentDate && input.paymentDate !== "" ? startOfDay(fromDateInput(input.paymentDate)) : input.status === "Pending" ? null : startOfDay(new Date());

    const data = {
      employeeName: input.employeeName,
      amount,
      month: input.month,
      paymentDate,
      amountPaid,
      status: input.status,
      notes: input.notes || null,
    };

    const salary = id
      ? await db.salary.update({ where: { id }, data })
      : await db.salary.create({ data });

    await syncSalaryTransaction(salary.id, user.id);
    done();
    return { ok: true, message: id ? "Salary updated" : "Salary added" };
  } catch (err) {
    return toActionError(err);
  }
}

/** One-click "Mark paid" from the salary list. */
export async function markSalaryPaid(id: string): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const salary = await db.salary.findUnique({ where: { id } });
    if (!salary) throw new UserError("Salary could not be found.");
    if (salary.status === "Paid") return { ok: true };

    await db.salary.update({
      where: { id },
      data: { status: "Paid", amountPaid: salary.amount, paymentDate: salary.paymentDate ?? startOfDay(new Date()) },
    });
    await syncSalaryTransaction(id, user.id);
    done();
    return { ok: true, message: `${salary.employeeName} marked paid — expense added` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteSalary(id: string): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const salary = await db.salary.findUnique({ where: { id } });
    if (!salary) throw new UserError("Salary could not be found.");

    // Drop its ledger entry first so no orphan expense is left behind.
    await db.salary.update({ where: { id }, data: { status: "Pending", amountPaid: 0 } });
    await syncSalaryTransaction(id, user.id);
    await db.salary.delete({ where: { id } });

    done();
    return { ok: true, message: "Salary deleted" };
  } catch (err) {
    return toActionError(err);
  }
}
