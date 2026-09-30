"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { bookMonthOf, parseAmount } from "@/lib/money";
import { isMonthClosed, nextRef } from "@/lib/transactions";
import { NotFoundError, assertClientInScope } from "@/lib/scope";

/**
 * Recurring spend.
 *
 * A rule does not create an approved entry. It creates a **Draft**, and
 * somebody still looks at it. That is deliberate: a subscription whose price
 * changed, or one that was cancelled last month, would otherwise quietly keep
 * appearing in the totals at the old figure and nobody would catch it until the
 * year-end. A draft in the queue is a prompt; an approved row is an assertion.
 *
 * Runs are idempotent per month. `nextRunAt` moves forward only once the row
 * exists, and a rule that has already produced this month's draft is skipped —
 * so the button can be pressed twice, or a cron can fire twice, without
 * doubling anybody's rent.
 */

const ruleFields = {
  clientId: z.string().min(1, "Choose a client"),
  name: z.string().trim().min(1, "What is it").max(160),
  amount: z.string().trim().min(1, "Enter an amount"),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  direction: z.enum(["IN", "OUT"]).default("OUT"),
  categoryId: z.string().optional(),
  dayOfMonth: z.number().int().min(1).max(28),
  active: z.boolean().default(true),
};

/** The next date this rule should fire, at or after `from`. */
function nextRun(dayOfMonth: number, from = new Date()): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const candidate = new Date(Date.UTC(year, month, dayOfMonth));
  return candidate >= from ? candidate : new Date(Date.UTC(year, month + 1, dayOfMonth));
}

export const createRecurring = defineAction({
  permission: "expense:create",
  input: z.object(ruleFields),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const amount = parseAmount(input.amount, input.currency);
    if (amount == null || amount <= 0n) {
      throw new UserError("That amount did not parse.", "invalid", { amount: ["Enter a positive number"] });
    }

    const rule = await ctx.db.recurringSpend.create({
      data: {
        tenantId: ctx.user.tenantId,
        clientId: input.clientId,
        categoryId: input.categoryId || null,
        direction: input.direction,
        name: input.name,
        amount,
        currency: input.currency,
        dayOfMonth: input.dayOfMonth,
        nextRunAt: nextRun(input.dayOfMonth),
        active: input.active,
      },
    });

    await ctx.audit({
      action: "created",
      resourceType: "RecurringSpend",
      resourceId: rule.id,
      resourceLabel: rule.name,
      after: { name: rule.name, amount: rule.amount.toString(), dayOfMonth: rule.dayOfMonth },
    });

    revalidatePath("/ledger/recurring");
    return { ok: true, data: { id: rule.id }, message: `${rule.name} added.` } satisfies ActionResult<{ id: string }>;
  },
});

export const updateRecurring = defineAction({
  permission: "expense:edit",
  input: z.object({ id: z.string().min(1), ...ruleFields }),
  async handler(ctx, input) {
    const before = await ctx.db.recurringSpend.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError();
    assertClientInScope(ctx.scope, before.clientId);
    assertClientInScope(ctx.scope, input.clientId);

    const amount = parseAmount(input.amount, input.currency);
    if (amount == null || amount <= 0n) {
      throw new UserError("That amount did not parse.", "invalid", { amount: ["Enter a positive number"] });
    }

    const after = await ctx.db.recurringSpend.update({
      where: { id: input.id },
      data: {
        clientId: input.clientId,
        categoryId: input.categoryId || null,
        direction: input.direction,
        name: input.name,
        amount,
        currency: input.currency,
        dayOfMonth: input.dayOfMonth,
        active: input.active,
        // Changing the day moves the next run; changing the price does not,
        // because this month's draft may already exist at the old figure.
        ...(before.dayOfMonth !== input.dayOfMonth ? { nextRunAt: nextRun(input.dayOfMonth) } : {}),
      },
    });

    await ctx.audit({
      action: "updated",
      resourceType: "RecurringSpend",
      resourceId: after.id,
      resourceLabel: after.name,
      before: { name: before.name, amount: before.amount.toString(), active: before.active, dayOfMonth: before.dayOfMonth },
      after: { name: after.name, amount: after.amount.toString(), active: after.active, dayOfMonth: after.dayOfMonth },
    });

    revalidatePath("/ledger/recurring");
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

export const deleteRecurring = defineAction({
  permission: "expense:delete",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const rule = await ctx.db.recurringSpend.findUnique({ where: { id: input.id } });
    if (!rule) throw new NotFoundError();
    assertClientInScope(ctx.scope, rule.clientId);

    // The rule goes; the drafts and entries it already produced stay. They are
    // real money that was really spent.
    await ctx.db.recurringSpend.delete({ where: { id: input.id } });

    await ctx.audit({
      action: "deleted",
      resourceType: "RecurringSpend",
      resourceId: rule.id,
      resourceLabel: rule.name,
      before: { name: rule.name, amount: rule.amount.toString() },
    });

    revalidatePath("/ledger/recurring");
    return { ok: true, message: `${rule.name} will not generate again.` } satisfies ActionResult;
  },
});

/**
 * Generates the drafts that are due.
 *
 * Called from the page today. It is written to be safe to call from a cron or
 * a webhook tomorrow without changing anything: idempotent per rule per month,
 * and it reports what it skipped and why rather than failing the whole run on
 * one closed month.
 */
export const runRecurring = defineAction({
  permission: "expense:create",
  input: z.object({ upTo: z.string().trim().optional() }),
  async handler(ctx, input) {
    const now = input.upTo ? new Date(input.upTo) : new Date();
    if (Number.isNaN(now.getTime())) throw new UserError("That date did not parse.", "invalid");

    const due = await ctx.db.recurringSpend.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      include: { client: { select: { id: true, name: true, deletedAt: true } } },
    });

    const created: string[] = [];
    const skipped: { name: string; why: string }[] = [];

    for (const rule of due) {
      if (rule.client.deletedAt) {
        skipped.push({ name: rule.name, why: "its client was deleted" });
        continue;
      }

      const date = rule.nextRunAt;
      const bookMonth = bookMonthOf(date);

      if (await isMonthClosed(ctx.scope, rule.clientId, bookMonth)) {
        skipped.push({ name: rule.name, why: `${bookMonth} is closed` });
        continue;
      }

      // Idempotence: one draft per rule per month. The tag is what identifies
      // it, so pressing the button twice cannot double anybody's rent.
      const already = await ctx.db.transaction.findFirst({
        where: { clientId: rule.clientId, bookMonth, tags: { has: `recurring:${rule.id}` }, deletedAt: null },
        select: { id: true },
      });

      if (already) {
        // Still move the clock forward, or it retries forever.
        await ctx.db.recurringSpend.update({
          where: { id: rule.id },
          data: { nextRunAt: nextRun(rule.dayOfMonth, new Date(date.getTime() + 86_400_000)) },
        });
        skipped.push({ name: rule.name, why: `${bookMonth} already has one` });
        continue;
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            tenantId: ctx.user.tenantId,
            ref: await nextRef(ctx.scope, date),
            direction: rule.direction,
            clientId: rule.clientId,
            bookMonth,
            date,
            categoryId: rule.categoryId,
            name: rule.name,
            amountOriginal: rule.amount,
            currencyOriginal: rule.currency,
            // A rule in a foreign currency needs a rate nobody has supplied, so
            // it books at 1 and the draft says so by being a draft.
            exchangeRate: "1",
            amountBase: rule.amount,
            description: "Generated from a recurring rule. Check the amount before approving.",
            tags: ["recurring", `recurring:${rule.id}`],
            approvalState: "Draft",
            createdById: ctx.user.id,
          },
        });

        await tx.recurringSpend.update({
          where: { id: rule.id },
          data: { nextRunAt: nextRun(rule.dayOfMonth, new Date(date.getTime() + 86_400_000)) },
        });
      });

      created.push(rule.name);
    }

    if (created.length) {
      await ctx.audit({
        action: "recurring_run",
        resourceType: "RecurringSpend",
        resourceId: `run:${now.toISOString()}`,
        resourceLabel: `${created.length} drafts`,
        after: { created, skipped },
      });
    }

    revalidatePath("/ledger");
    revalidatePath("/ledger/recurring");

    return {
      ok: true,
      data: { created: created.length, skipped },
      message:
        created.length === 0
          ? skipped.length
            ? `Nothing generated — ${skipped.length} skipped.`
            : "Nothing is due."
          : `${created.length} ${created.length === 1 ? "draft" : "drafts"} created. Check the amounts before approving.`,
    } satisfies ActionResult<{ created: number; skipped: { name: string; why: string }[] }>;
  },
});
