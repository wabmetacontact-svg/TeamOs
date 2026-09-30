"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { isBookMonth, parseAmount } from "@/lib/money";
import { assertClientInScope, NotFoundError } from "@/lib/scope";

/**
 * Recording what a source sheet said, and settling the difference.
 *
 * The figures are typed in from the sheet by hand. That is not a gap waiting
 * for an integration — it is the point. A number read off the source by a
 * person is independent of the import; a number extracted by the same code
 * that did the importing would agree with itself and prove nothing.
 */

const monthInput = z.object({
  clientId: z.string().min(1),
  month: z.string().trim().refine(isBookMonth, "Use yyyy-MM"),
});

export const recordExpectation = defineAction({
  permission: "expense:edit",
  input: monthInput.extend({
    expectedIncome: z.string().trim(),
    expectedSpend: z.string().trim(),
    source: z.string().trim().max(120).optional(),
  }),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const client = await ctx.db.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
    if (!client) throw new NotFoundError();

    const income = parseAmount(input.expectedIncome || "0", ctx.user.baseCurrency);
    const spend = parseAmount(input.expectedSpend || "0", ctx.user.baseCurrency);

    if (income == null || spend == null) {
      throw new UserError("One of those figures did not parse.", "invalid", {
        expectedIncome: income == null ? ["Enter a number"] : [],
        expectedSpend: spend == null ? ["Enter a number"] : [],
      });
    }
    if (income < 0n || spend < 0n) {
      throw new UserError("Both figures are totals, so both are positive.", "invalid");
    }

    const existing = await ctx.db.reconciliation.findFirst({
      where: { clientId: input.clientId, month: input.month },
    });

    const row = await ctx.db.reconciliation.upsert({
      where: { clientId_month: { clientId: input.clientId, month: input.month } },
      create: {
        tenantId: ctx.user.tenantId,
        clientId: input.clientId,
        month: input.month,
        expectedIncome: income,
        expectedSpend: spend,
        source: input.source || null,
        recordedById: ctx.user.id,
      },
      update: {
        expectedIncome: income,
        expectedSpend: spend,
        source: input.source || null,
        // Changing the expectation un-resolves it. A month somebody signed off
        // against a figure that has since changed is not a month anybody
        // signed off.
        ...(existing?.resolvedAt ? { resolvedAt: null, resolvedById: null } : {}),
      },
    });

    await ctx.audit({
      action: existing ? "updated" : "created",
      resourceType: "Reconciliation",
      resourceId: row.id,
      resourceLabel: `${client.name} · ${input.month}`,
      ...(existing
        ? {
            before: {
              expectedIncome: existing.expectedIncome.toString(),
              expectedSpend: existing.expectedSpend.toString(),
              resolved: Boolean(existing.resolvedAt),
            },
          }
        : {}),
      after: {
        expectedIncome: income.toString(),
        expectedSpend: spend.toString(),
        source: input.source || null,
      },
    });

    revalidatePath("/ledger/reconcile");
    return {
      ok: true,
      message: existing
        ? `${client.name} · ${input.month} updated${existing.resolvedAt ? " and reopened" : ""}.`
        : `${client.name} · ${input.month} recorded.`,
    } satisfies ActionResult;
  },
});

/**
 * Settling a client-month.
 *
 * Allowed while a difference remains, and requires a note when it does —
 * because a difference somebody investigated and explained is the normal
 * outcome, not a failure. "Sheet double-counted the April retainer" is a
 * finished reconciliation. Silence is not.
 */
export const resolveMonth = defineAction({
  permission: "expense:approve",
  input: monthInput.extend({ note: z.string().trim().max(1000).optional() }),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const row = await ctx.db.reconciliation.findFirst({
      where: { clientId: input.clientId, month: input.month },
      include: { client: { select: { name: true } } },
    });
    if (!row) throw new NotFoundError();
    if (row.resolvedAt) throw new UserError("That month is already settled.");

    const actual = await ctx.db.transaction.groupBy({
      by: ["direction"],
      where: {
        clientId: input.clientId,
        bookMonth: input.month,
        deletedAt: null,
        approvalState: "Approved",
      },
      _sum: { amountBase: true },
    });

    const income = actual.find((r) => r.direction === "IN")?._sum.amountBase ?? 0n;
    const spend = actual.find((r) => r.direction === "OUT")?._sum.amountBase ?? 0n;
    const matches = income === row.expectedIncome && spend === row.expectedSpend;

    if (!matches && !input.note) {
      throw new UserError(
        "The figures still differ. Say what accounts for it — a settled month with an unexplained gap is worse than an open one.",
        "invalid",
        { note: ["Required while the figures differ"] },
      );
    }

    await ctx.db.reconciliation.update({
      where: { id: row.id },
      data: { resolvedAt: new Date(), resolvedById: ctx.user.id, note: input.note || null },
    });

    await ctx.audit({
      action: "resolved",
      resourceType: "Reconciliation",
      resourceId: row.id,
      resourceLabel: `${row.client.name} · ${input.month}`,
      before: { resolved: false },
      after: {
        resolved: true,
        matched: matches,
        // The figures as they stood at the moment of settling. If the month
        // moves afterwards, this is what it was signed off against.
        expectedIncome: row.expectedIncome.toString(),
        expectedSpend: row.expectedSpend.toString(),
        actualIncome: income.toString(),
        actualSpend: spend.toString(),
        note: input.note || null,
      },
    });

    revalidatePath("/ledger/reconcile");
    return {
      ok: true,
      message: matches ? `${input.month} settled — figures agree exactly.` : `${input.month} settled with a note.`,
    } satisfies ActionResult;
  },
});

export const reopenReconciliation = defineAction({
  permission: "expense:approve",
  input: monthInput.extend({ reason: z.string().trim().min(3, "Say why").max(500) }),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const row = await ctx.db.reconciliation.findFirst({
      where: { clientId: input.clientId, month: input.month },
      include: { client: { select: { name: true } } },
    });
    if (!row?.resolvedAt) throw new UserError("That month is not settled.");

    await ctx.db.reconciliation.update({
      where: { id: row.id },
      data: { resolvedAt: null, resolvedById: null, note: `${row.note ?? ""}\n\nReopened: ${input.reason}`.trim() },
    });

    await ctx.audit({
      action: "reopened",
      resourceType: "Reconciliation",
      resourceId: row.id,
      resourceLabel: `${row.client.name} · ${input.month}`,
      before: { resolved: true, resolvedAt: row.resolvedAt.toISOString() },
      after: { resolved: false, reason: input.reason },
    });

    revalidatePath("/ledger/reconcile");
    return { ok: true, message: `${input.month} reopened.` } satisfies ActionResult;
  },
});

export const removeExpectation = defineAction({
  permission: "expense:delete",
  input: monthInput,
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const row = await ctx.db.reconciliation.findFirst({
      where: { clientId: input.clientId, month: input.month },
      include: { client: { select: { name: true } } },
    });
    if (!row) throw new NotFoundError();

    await ctx.db.reconciliation.delete({ where: { id: row.id } });

    await ctx.audit({
      action: "deleted",
      resourceType: "Reconciliation",
      resourceId: row.id,
      resourceLabel: `${row.client.name} · ${input.month}`,
      before: {
        expectedIncome: row.expectedIncome.toString(),
        expectedSpend: row.expectedSpend.toString(),
        resolved: Boolean(row.resolvedAt),
      },
    });

    revalidatePath("/ledger/reconcile");
    return { ok: true, message: "Removed." } satisfies ActionResult;
  },
});
