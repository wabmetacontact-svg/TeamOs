"use server";

import { z } from "zod";
import { MNF, daysInMonth, readAmount } from "@/lib/format";
import { mutate, type Tx } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { mapAdSpend, toDate, toPaise } from "@/lib/workspace";
import { ID, memberOf, outEntries, parse, rs } from "@/lib/action-helpers";

/**
 * Ad spend and leads, per person per month.
 *
 * The money goes into the ledger as an expense in the same transaction, and
 * comes out with it, so there is still one place money lives and the month's
 * profit already counts what was spent on ads. Needs Ads edit; the expense it
 * writes then shows to whoever can see overhead money, like a salary does.
 */

const CATEGORY = "Ads";

const form = z.object({
  memberId: ID,
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month."),
  amount: z.union([z.string(), z.number()]).default(""),
  leads: z.union([z.string(), z.number()]).default(""),
  note: z.string().trim().max(300).default(""),
});

export async function addAdSpend(raw: z.input<typeof form>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("ads", "edit");
    const f = parse(ctx, form, raw);
    const m = await memberOf(ctx, f.memberId, "memberId");

    const amount = f.amount === "" ? 0 : readAmount(f.amount);
    const leads = f.leads === "" ? 0 : Number(f.leads);
    if (!Number.isFinite(amount) || amount < 0) ctx.fail("Enter the amount spent in rupees.", { amount: "Rupees, zero or more." });
    if (!Number.isInteger(leads) || leads < 0) ctx.fail("Enter the number of leads as a whole number.", { leads: "A whole number." });
    if (amount === 0 && leads === 0) ctx.fail("Enter what was spent, how many leads came, or both.");

    // The expense, if it cost anything. Dated in its month: today for the
    // current month, otherwise the 28th, as salaries are.
    let ledgerEntryId: string | null = null;
    if (amount > 0) {
      const categories = await ensureCategory(ctx.tx, ctx.tenantId);
      if (categories) ctx.tenantPatch({ expenseCategories: categories });
      const day = f.month === ctx.today.slice(0, 7) ? ctx.today : `${f.month}-${String(Math.min(28, daysInMonth(f.month))).padStart(2, "0")}`;
      const entry = await ctx.tx.ledgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          type: "out",
          date: toDate(day),
          description: `Ads for ${m.name}, ${MNF[Number(f.month.slice(5)) - 1]}${f.note ? ` - ${f.note}` : ""}`,
          category: CATEGORY,
          amount: toPaise(amount),
          status: "paid",
          memberId: m.id,
          createdById: ctx.me.id,
        },
      });
      ledgerEntryId = entry.id;
      await outEntries(ctx, [entry.id]);
    }

    const row = await ctx.tx.adSpend.create({
      data: {
        tenantId: ctx.tenantId,
        memberId: m.id,
        month: toDate(`${f.month}-01`),
        amount: toPaise(amount),
        leads,
        note: f.note,
        ledgerEntryId,
        createdById: ctx.me.id,
      },
    });
    ctx.upsert("adSpends", [mapAdSpend(row)]);
    await ctx.log({
      kind: "expense",
      text: `recorded ads for ${m.name}`,
      target: "Ads",
      area: "ledger",
      to: `${rs(amount)} · ${leads} lead${leads === 1 ? "" : "s"} · ${f.month}`,
    });
    return amount ? `Recorded, and ${rs(amount)} added to expenses under Ads.` : "Leads recorded.";
  });
}

/** Removes an ad spend and the expense it wrote, together. */
export async function removeAdSpend(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("ads", "edit");
    const row = await ctx.tx.adSpend.findFirst({ where: { id }, include: { member: true } });
    if (!row) ctx.fail("That ad spend no longer exists.");
    if (row!.ledgerEntryId) {
      await ctx.tx.ledgerEntry.deleteMany({ where: { id: row!.ledgerEntryId } });
      ctx.remove("ledger", [row!.ledgerEntryId]);
    }
    await ctx.tx.adSpend.delete({ where: { id } });
    ctx.remove("adSpends", [id]);
    await ctx.log({ kind: "expense", text: `removed ads recorded for ${row!.member.name}`, target: "Ads", area: "ledger", from: rs(Number(row!.amount) / 100) });
    return "Removed, with its expense.";
  });
}

async function ensureCategory(tx: Tx, tenantId: string): Promise<string[] | null> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { expenseCategories: true } });
  if (t.expenseCategories.includes(CATEGORY)) return null;
  const next = [...t.expenseCategories, CATEGORY];
  await tx.tenant.update({ where: { id: tenantId }, data: { expenseCategories: next } });
  return next;
}
