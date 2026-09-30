"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionContext, type ActionResult } from "@/lib/action";
import { bookMonthOf, convert, isBookMonth, parseAmount } from "@/lib/money";
import { getTransaction, isMonthClosed, nextRef } from "@/lib/transactions";
import { assertClientInScope, can, NotFoundError } from "@/lib/scope";
import { notify } from "@/lib/notifications";
import { holdersOf } from "@/lib/permissions";

/**
 * Writing to the ledger.
 *
 * Three rules hold across all of it.
 *
 * `amountBase` is computed here, once, from the rate supplied at entry, and is
 * never recomputed anywhere. Every total is built from that column. A rate
 * change tomorrow cannot move today's figures because today's row already
 * holds its own answer.
 *
 * A closed month is refused twice — here with a sentence somebody can act on,
 * and again by a database trigger that does not care which code path asked.
 * The first is courtesy; the second is the guarantee.
 *
 * And nothing is ever hard-deleted. A row that reconciled against somebody's
 * sheet last month has to still be findable when they ask why the number
 * changed.
 */

const baseFields = {
  clientId: z.string().min(1, "Choose a client"),
  direction: z.enum(["IN", "OUT"]),
  name: z.string().trim().min(1, "Who was paid, or who paid").max(160),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
  bookMonth: z.string().trim().optional(),
  amount: z.string().trim().min(1, "Enter an amount"),
  currency: z.string().trim().length(3, "Three-letter code").toUpperCase().default("INR"),
  exchangeRate: z.string().trim().optional(),
  categoryId: z.string().optional(),
  vendorId: z.string().optional(),
  paymentMethod: z.enum(["Bank", "Card", "UPI", "Crypto", "Cash", "Other"]).default("Bank"),
  paymentStatus: z.enum(["Paid", "Pending", "Overdue"]).default("Paid"),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
};

/**
 * Turns the form's strings into the two amounts that get stored.
 *
 * The book month defaults to the month the transaction happened in, but is
 * stored separately and can differ: an invoice paid on 2 October for September
 * work belongs to September's book, and forcing it into October would make
 * September's total wrong forever.
 */
async function resolveAmounts(
  ctx: ActionContext,
  input: { clientId: string; date: string; bookMonth?: string; amount: string; currency: string; exchangeRate?: string },
) {
  const date = new Date(`${input.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new UserError("That date did not parse.", "invalid");

  const bookMonth = input.bookMonth || bookMonthOf(date);
  if (!isBookMonth(bookMonth)) throw new UserError("Book month must be yyyy-MM.", "invalid");

  const amountOriginal = parseAmount(input.amount, input.currency);
  if (amountOriginal == null) throw new UserError("That amount did not parse.", "invalid", { amount: ["Enter a number"] });
  if (amountOriginal <= 0n) {
    throw new UserError("Amounts are positive; the direction says which way it went.", "invalid", {
      amount: ["Must be more than zero"],
    });
  }

  const base = ctx.user.baseCurrency;
  const sameCurrency = input.currency === base;
  const rate = sameCurrency ? "1" : (input.exchangeRate?.trim() || "");

  if (!sameCurrency && !rate) {
    throw new UserError(`Enter the ${input.currency}→${base} rate that applied on the day.`, "invalid", {
      exchangeRate: ["Required for a foreign currency"],
    });
  }
  if (!sameCurrency && !(Number(rate) > 0)) {
    throw new UserError("That exchange rate did not parse.", "invalid", { exchangeRate: ["Enter a positive number"] });
  }

  return {
    date,
    bookMonth,
    amountOriginal,
    currencyOriginal: input.currency,
    exchangeRate: rate,
    // Computed once, here. Nothing recomputes it.
    amountBase: convert(amountOriginal, rate, input.currency, base),
  };
}

/** Both halves of the closed-month guard; this is the half with a sentence. */
async function refuseIfClosed(ctx: ActionContext, clientId: string, bookMonth: string) {
  if (await isMonthClosed(ctx.scope, clientId, bookMonth)) {
    throw new UserError(
      `${bookMonth} is closed for this client. Reopen it first — that is recorded, and asks for a reason.`,
    );
  }
}

export const createTransaction = defineAction({
  permission: "expense:create",
  input: z.object(baseFields),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const amounts = await resolveAmounts(ctx, input);
    await refuseIfClosed(ctx, input.clientId, amounts.bookMonth);

    if (input.categoryId) {
      const category = await ctx.db.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new UserError("That category no longer exists.", "not_found");
      if (category.direction !== input.direction) {
        throw new UserError(
          `${category.name} is a ${category.direction === "IN" ? "income" : "spend"} category. Pick one that matches.`,
          "invalid",
          { categoryId: ["Wrong direction"] },
        );
      }
    }

    // A Member's entry starts as a Draft they still have to submit; anyone who
    // can approve skips straight past the queue they would only approve
    // themselves in.
    const selfApproves = can(ctx.scope, "expense:approve");

    const transaction = await ctx.db.transaction.create({
      data: {
        tenantId: ctx.user.tenantId,
        ref: await nextRef(ctx.scope, amounts.date),
        direction: input.direction,
        clientId: input.clientId,
        bookMonth: amounts.bookMonth,
        date: amounts.date,
        categoryId: input.categoryId || null,
        vendorId: input.vendorId || null,
        name: input.name,
        amountOriginal: amounts.amountOriginal,
        currencyOriginal: amounts.currencyOriginal,
        exchangeRate: amounts.exchangeRate,
        amountBase: amounts.amountBase,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        description: input.description || null,
        tags: input.tags,
        approvalState: selfApproves ? "Approved" : "Draft",
        submittedAt: selfApproves ? new Date() : null,
        approvedById: selfApproves ? ctx.user.id : null,
        approvedAt: selfApproves ? new Date() : null,
        createdById: ctx.user.id,
      },
    });

    await ctx.audit({
      action: "created",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      after: {
        direction: transaction.direction,
        amountBase: transaction.amountBase.toString(),
        bookMonth: transaction.bookMonth,
        approvalState: transaction.approvalState,
      },
    });

    revalidatePath("/ledger");
    return {
      ok: true,
      data: { id: transaction.id, ref: transaction.ref },
      message: selfApproves ? `${transaction.ref} recorded.` : `${transaction.ref} saved as a draft.`,
    } satisfies ActionResult<{ id: string; ref: string }>;
  },
});

export const updateTransaction = defineAction({
  permission: "expense:edit",
  input: z.object({ id: z.string().min(1), ...baseFields }),
  async handler(ctx, input) {
    const before = await getTransaction(ctx.scope, input.id);
    assertClientInScope(ctx.scope, input.clientId);

    const amounts = await resolveAmounts(ctx, input);

    // Both the month it is leaving and the month it is entering.
    await refuseIfClosed(ctx, before.clientId, before.bookMonth);
    await refuseIfClosed(ctx, input.clientId, amounts.bookMonth);

    // Someone else's draft is theirs until they submit it.
    if (before.approvalState === "Draft" && before.createdById !== ctx.user.id && !can(ctx.scope, "expense:approve")) {
      throw new UserError("That is somebody else's draft.", "denied");
    }

    const wasApproved = before.approvalState === "Approved";

    const after = await ctx.db.transaction.update({
      where: { id: input.id },
      data: {
        direction: input.direction,
        clientId: input.clientId,
        bookMonth: amounts.bookMonth,
        date: amounts.date,
        categoryId: input.categoryId || null,
        vendorId: input.vendorId || null,
        name: input.name,
        amountOriginal: amounts.amountOriginal,
        currencyOriginal: amounts.currencyOriginal,
        exchangeRate: amounts.exchangeRate,
        amountBase: amounts.amountBase,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        description: input.description || null,
        tags: input.tags,
        // Editing an approved row sends it back for approval. The alternative
        // is an approval that refers to figures nobody approved.
        ...(wasApproved && changesTheMoney(before, amounts)
          ? { approvalState: "Submitted", approvedById: null, approvedAt: null, submittedAt: new Date() }
          : {}),
      },
    });

    // The gate asks specifically that an edit to an approved row writes a
    // before/after entry. It writes one for every edit; approved is simply the
    // case where it matters most.
    await ctx.audit({
      action: wasApproved ? "updated_after_approval" : "updated",
      resourceType: "Transaction",
      resourceId: after.id,
      resourceLabel: `${after.ref} · ${after.name}`,
      before: snapshot(before),
      after: snapshot(after),
    });

    revalidatePath("/ledger");
    revalidatePath(`/ledger/${input.id}`);

    return {
      ok: true,
      message:
        wasApproved && changesTheMoney(before, amounts)
          ? `${after.ref} changed and is back in the approval queue.`
          : "Saved.",
    } satisfies ActionResult;
  },
});

export const submitTransaction = defineAction({
  permission: "expense:create",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const transaction = await getTransaction(ctx.scope, input.id);
    if (transaction.approvalState !== "Draft" && transaction.approvalState !== "Rejected") {
      throw new UserError(`${transaction.ref} is already ${transaction.approvalState.toLowerCase()}.`);
    }
    await refuseIfClosed(ctx, transaction.clientId, transaction.bookMonth);

    await ctx.db.transaction.update({
      where: { id: input.id },
      data: { approvalState: "Submitted", submittedAt: new Date(), rejectionReason: null },
    });

    await ctx.audit({
      action: "submitted",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      before: { approvalState: transaction.approvalState },
      after: { approvalState: "Submitted" },
    });

    // Whoever can approve is now blocking this person. Queued, never awaited
    // for its outcome — see lib/notifications.ts.
    const approvers = await ctx.db.user.findMany({
      where: { status: "Active", ...holdersOf("expense:approve") },
      select: { id: true },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: approvers.map((u) => u.id),
      exceptUserId: ctx.user.id,
      event: "expense.submitted",
      title: `${transaction.ref} needs a decision`,
      body: `${transaction.name} · ${transaction.client.name}`,
      link: `/ledger/${transaction.id}`,
    });

    revalidatePath("/ledger");
    return { ok: true, message: `${transaction.ref} submitted.` } satisfies ActionResult;
  },
});

export const decideTransaction = defineAction({
  permission: "expense:approve",
  input: z.object({
    id: z.string().min(1),
    decision: z.enum(["Approved", "Rejected"]),
    reason: z.string().trim().max(500).optional(),
  }),
  async handler(ctx, input) {
    const transaction = await getTransaction(ctx.scope, input.id);

    if (transaction.approvalState !== "Submitted") {
      throw new UserError(`${transaction.ref} is not waiting for a decision.`);
    }
    if (input.decision === "Rejected" && !input.reason) {
      throw new UserError("Say why — the person who entered it has to know what to fix.", "invalid", {
        reason: ["A reason is required"],
      });
    }
    await refuseIfClosed(ctx, transaction.clientId, transaction.bookMonth);

    await ctx.db.transaction.update({
      where: { id: input.id },
      data: {
        approvalState: input.decision,
        approvedById: ctx.user.id,
        approvedAt: new Date(),
        rejectionReason: input.decision === "Rejected" ? (input.reason ?? null) : null,
      },
    });

    await ctx.audit({
      action: input.decision === "Approved" ? "approved" : "rejected",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      before: { approvalState: "Submitted" },
      after: { approvalState: input.decision, reason: input.reason ?? null, amountBase: transaction.amountBase.toString() },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: [transaction.createdById],
      exceptUserId: ctx.user.id,
      event: input.decision === "Approved" ? "expense.approved" : "expense.rejected",
      title: `${transaction.ref} was ${input.decision.toLowerCase()}`,
      body: input.reason ?? transaction.name,
      link: `/ledger/${transaction.id}`,
    });

    revalidatePath("/ledger");
    revalidatePath("/ledger/approvals");
    return { ok: true, message: `${transaction.ref} ${input.decision.toLowerCase()}.` } satisfies ActionResult;
  },
});

export const deleteTransaction = defineAction({
  permission: "expense:delete",
  input: z.object({ id: z.string().min(1), reason: z.string().trim().max(500).optional() }),
  async handler(ctx, input) {
    const transaction = await getTransaction(ctx.scope, input.id);
    await refuseIfClosed(ctx, transaction.clientId, transaction.bookMonth);

    if (transaction.approvalState === "Approved" && !input.reason) {
      throw new UserError("This one was approved. Say why it is going.", "invalid", {
        reason: ["A reason is required for an approved entry"],
      });
    }

    // Soft, always. Every total filters deletedAt, and the row stays for
    // whoever asks in March why February moved.
    await ctx.db.transaction.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

    await ctx.audit({
      action: "deleted",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      before: { ...snapshot(transaction), approvalState: transaction.approvalState },
      after: { reason: input.reason ?? null },
    });

    revalidatePath("/ledger");
    return { ok: true, message: `${transaction.ref} removed.` } satisfies ActionResult;
  },
});

export const restoreTransaction = defineAction({
  permission: "expense:delete",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const transaction = await ctx.db.transaction.findFirst({ where: { id: input.id, deletedAt: { not: null } } });
    if (!transaction) throw new NotFoundError();

    assertClientInScope(ctx.scope, transaction.clientId);
    await refuseIfClosed(ctx, transaction.clientId, transaction.bookMonth);

    await ctx.db.transaction.update({ where: { id: input.id }, data: { deletedAt: null } });
    await ctx.audit({
      action: "restored",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      after: { amountBase: transaction.amountBase.toString() },
    });

    revalidatePath("/ledger");
    return { ok: true, message: `${transaction.ref} restored.` } satisfies ActionResult;
  },
});

/** The fields whose change invalidates an approval. */
function changesTheMoney(
  before: { amountBase: bigint; direction: string; clientId: string; bookMonth: string },
  after: { amountBase: bigint; bookMonth: string },
): boolean {
  return before.amountBase !== after.amountBase || before.bookMonth !== after.bookMonth;
}

function snapshot(t: {
  name: string;
  direction: string;
  clientId: string;
  bookMonth: string;
  amountOriginal: bigint;
  currencyOriginal: string;
  amountBase: bigint;
  categoryId: string | null;
  paymentStatus: string;
}) {
  return {
    name: t.name,
    direction: t.direction,
    clientId: t.clientId,
    bookMonth: t.bookMonth,
    // BigInt is not JSON, and the audit column is JSON.
    amountOriginal: t.amountOriginal.toString(),
    currencyOriginal: t.currencyOriginal,
    amountBase: t.amountBase.toString(),
    categoryId: t.categoryId,
    paymentStatus: t.paymentStatus,
  };
}
