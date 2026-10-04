"use server";

import { z } from "zod";
import { readAmount, ymLabel } from "@/lib/format";
import { mutate } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { mapTarget, toDate, toPaise } from "@/lib/workspace";
import { ID, memberOf, parse, rs } from "@/lib/action-helpers";

/**
 * Monthly sales targets, for the whole team or one person. Setting one for a
 * month that already has one replaces it. Needs Targets edit.
 */

const form = z.object({
  /** "" is the whole team. */
  memberId: z.union([ID, z.literal("")]).default(""),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month."),
  sales: z.union([z.string(), z.number()]).default(""),
  amount: z.union([z.string(), z.number()]).default(""),
  dailySales: z.union([z.string(), z.number()]).default(""),
  dailyAmount: z.union([z.string(), z.number()]).default(""),
});

export async function setTarget(raw: z.input<typeof form>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("targets", "edit");
    const f = parse(ctx, form, raw);
    const who = f.memberId ? await memberOf(ctx, f.memberId, "memberId") : null;

    const count = (v: string | number, field: string) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) ctx.fail("A number of sales is a whole number, zero or more.", { [field]: "A whole number." });
      return n;
    };
    const money = (v: string | number, field: string) => {
      if (v === "") return null;
      const n = readAmount(v);
      if (!Number.isFinite(n) || n < 0) ctx.fail("Enter an amount in rupees, zero or more.", { [field]: "Rupees, zero or more." });
      return n;
    };
    const sales = count(f.sales, "sales");
    const amount = money(f.amount, "amount");
    const dailySales = count(f.dailySales, "dailySales");
    const dailyAmount = money(f.dailyAmount, "dailyAmount");
    if (sales === null && amount === null && dailySales === null && dailyAmount === null) {
      ctx.fail("Enter at least one target: sales or amount, for the month or per day.");
    }

    const data = {
      sales,
      amount: amount === null ? null : toPaise(amount),
      dailySales,
      dailyAmount: dailyAmount === null ? null : toPaise(dailyAmount),
    };
    const month = toDate(`${f.month}-01`);
    const existing = await ctx.tx.target.findFirst({ where: { month, memberId: who?.id ?? null } });
    const row = existing
      ? await ctx.tx.target.update({ where: { id: existing.id }, data })
      : await ctx.tx.target.create({ data: { tenantId: ctx.tenantId, memberId: who?.id ?? null, month, createdById: ctx.me.id, ...data } });

    ctx.upsert("targets", [mapTarget(row)]);
    const name = who ? who.name : "the team";
    await ctx.log({
      kind: "team",
      text: `${existing ? "changed" : "set"} the target for ${name}`,
      target: `Targets, ${ymLabel(f.month)}`,
      area: "targets",
      to: describe(sales, amount, dailySales, dailyAmount),
    });
    return `Target for ${name} saved.`;
  });
}

export async function removeTarget(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("targets", "edit");
    const row = await ctx.tx.target.findFirst({ where: { id }, include: { member: true } });
    if (!row) ctx.fail("That target no longer exists.");
    await ctx.tx.target.delete({ where: { id } });
    ctx.remove("targets", [id]);
    await ctx.log({
      kind: "team",
      text: `removed the target for ${row!.member?.name ?? "the team"}`,
      target: `Targets, ${ymLabel(row!.month.toISOString().slice(0, 7))}`,
      area: "targets",
    });
    return "Target removed.";
  });
}

function describe(sales: number | null, amount: number | null, dailySales: number | null, dailyAmount: number | null) {
  const parts = [];
  if (sales !== null) parts.push(`${sales} sale${sales === 1 ? "" : "s"}`);
  if (amount !== null) parts.push(rs(amount));
  if (dailySales !== null) parts.push(`${dailySales}/day`);
  if (dailyAmount !== null) parts.push(`${rs(dailyAmount)}/day`);
  return parts.join(" · ");
}
