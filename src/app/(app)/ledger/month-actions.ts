"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { isBookMonth } from "@/lib/money";
import { assertClientInScope } from "@/lib/scope";
import { notify } from "@/lib/notifications";
import { holdersOf } from "@/lib/permissions";

/**
 * Closing and reopening a book month.
 *
 * Closing is what makes a number citable: once a month is closed, nothing in it
 * moves, so a figure quoted from it in March still means the same thing in
 * September. The database enforces that with a trigger — see the
 * closed_month_guard migration — so it holds against an import script and an
 * admin console, not only against this form.
 *
 * Reopening is allowed, because sometimes a month genuinely has to change. It
 * costs a written reason, and the reason is kept.
 */

const monthInput = z.object({
  clientId: z.string().min(1),
  month: z.string().trim().refine(isBookMonth, "Use yyyy-MM"),
});

export const closeBookMonth = defineAction({
  permission: "book_month:close",
  input: monthInput.extend({ force: z.boolean().default(false) }),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const client = await ctx.db.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
    if (!client) throw new UserError("That client no longer exists.", "not_found");

    const existing = await ctx.db.bookMonth.findFirst({ where: { clientId: input.clientId, month: input.month } });
    if (existing?.state === "Closed") throw new UserError(`${input.month} is already closed for ${client.name}.`);

    // Closing over unapproved rows is the mistake this is here to prevent: the
    // month's total would exclude them, and nobody could approve them
    // afterwards without a reopen.
    const pending = await ctx.db.transaction.groupBy({
      by: ["approvalState"],
      where: {
        clientId: input.clientId,
        bookMonth: input.month,
        deletedAt: null,
        approvalState: { in: ["Draft", "Submitted"] },
      },
      _count: { _all: true },
    });

    const unapproved = pending.reduce((sum, row) => sum + row._count._all, 0);
    if (unapproved > 0 && !input.force) {
      const parts = pending.map((p) => `${p._count._all} ${p.approvalState.toLowerCase()}`);
      throw new UserError(
        `${input.month} still has ${parts.join(" and ")}. Those will not be in the total, and cannot be approved once it is closed. Clear them, or close it anyway if that is deliberate.`,
      );
    }

    await ctx.db.bookMonth.upsert({
      where: { clientId_month: { clientId: input.clientId, month: input.month } },
      create: {
        tenantId: ctx.user.tenantId,
        clientId: input.clientId,
        month: input.month,
        state: "Closed",
        closedAt: new Date(),
        closedById: ctx.user.id,
      },
      update: { state: "Closed", closedAt: new Date(), closedById: ctx.user.id, reopenReason: null },
    });

    // The totals as they stood at the moment of closing, in the audit entry.
    // This is what somebody compares against when they ask why a number moved.
    const totals = await ctx.db.transaction.groupBy({
      by: ["direction"],
      where: { clientId: input.clientId, bookMonth: input.month, deletedAt: null, approvalState: "Approved" },
      _sum: { amountBase: true },
      _count: { _all: true },
    });

    await ctx.audit({
      action: "closed",
      resourceType: "BookMonth",
      resourceId: `${input.clientId}:${input.month}`,
      resourceLabel: `${client.name} · ${input.month}`,
      // A month that had never been recorded and one that was explicitly
      // reopened both become Closed here, and the two are different stories.
      before: { state: existing?.state ?? "Open", reopenReason: existing?.reopenReason ?? null },
      after: {
        month: input.month,
        client: client.name,
        closedOver: unapproved,
        totals: Object.fromEntries(totals.map((t) => [t.direction, (t._sum.amountBase ?? 0n).toString()])),
        counts: Object.fromEntries(totals.map((t) => [t.direction, t._count._all])),
      },
    });

    revalidatePath("/ledger");
    revalidatePath("/ledger/months");

    return {
      ok: true,
      message:
        unapproved > 0
          ? `${input.month} closed for ${client.name}, with ${unapproved} unapproved left out.`
          : `${input.month} closed for ${client.name}.`,
    } satisfies ActionResult;
  },
});

export const reopenBookMonth = defineAction({
  permission: "book_month:reopen",
  input: monthInput.extend({ reason: z.string().trim().min(3, "Say why — this is the record of it").max(500) }),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const client = await ctx.db.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
    if (!client) throw new UserError("That client no longer exists.", "not_found");

    const existing = await ctx.db.bookMonth.findFirst({ where: { clientId: input.clientId, month: input.month } });
    if (!existing || existing.state !== "Closed") {
      throw new UserError(`${input.month} is not closed for ${client.name}.`);
    }

    await ctx.db.bookMonth.update({
      where: { clientId_month: { clientId: input.clientId, month: input.month } },
      data: { state: "Open", reopenReason: input.reason },
    });

    await ctx.audit({
      action: "reopened",
      resourceType: "BookMonth",
      resourceId: `${input.clientId}:${input.month}`,
      resourceLabel: `${client.name} · ${input.month}`,
      before: { state: "Closed", closedAt: existing.closedAt?.toISOString() ?? null },
      after: { state: "Open", reason: input.reason },
    });

    // Anybody who can close a month has probably quoted a figure from this
    // one. They should hear that it can move again.
    const closers = await ctx.db.user.findMany({
      where: { status: "Active", ...holdersOf("book_month:close") },
      select: { id: true },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: closers.map((u) => u.id),
      exceptUserId: ctx.user.id,
      event: "month.reopened",
      title: `${input.month} reopened for ${client.name}`,
      body: input.reason,
      link: "/ledger/months",
    });

    revalidatePath("/ledger");
    revalidatePath("/ledger/months");

    return {
      ok: true,
      message: `${input.month} reopened for ${client.name}. Anything reported from it may now change.`,
    } satisfies ActionResult;
  },
});
