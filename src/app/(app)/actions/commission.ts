"use server";

import { z } from "zod";
import { pct } from "@/lib/commission";
import { commissionRowFor, monthRange } from "@/lib/commission-server";
import { MNF, daysInMonth, readAmount } from "@/lib/format";
import { mutate, type Tx } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { mapCommissionRate, mapCommissionRule, toDate, toPaise } from "@/lib/workspace";
import { DATE, ID, clientOf, memberOf, outEntries, parse, rs } from "@/lib/action-helpers";

/**
 * Commission: a rate per member, commissions given by hand, and paying them.
 *
 * Everything here needs Payroll edit, the same as salaries: what somebody is
 * paid is one decision, whichever part of it it is.
 */

const YM = z.string().regex(/^\d{4}-\d{2}$/, "Pick a month.");
const CATEGORY = "Commissions";

// ─── the rate ──────────────────────────────────────────────────────────────

const rateForm = z.object({
  memberId: ID,
  pct: z.union([z.string(), z.number()]),
  from: DATE,
});

/** A member's share of what their own clients pay, from a date. Kept as history. */
export async function saveCommissionRate(raw: z.input<typeof rateForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll", "edit");
    const f = parse(ctx, rateForm, raw);
    const value = readAmount(f.pct);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      ctx.fail("Enter a rate between 0 and 100 percent.", { pct: "Between 0 and 100." });
    }
    const m = await memberOf(ctx, f.memberId, "memberId");
    const bps = Math.round(value * 100);

    const row = await ctx.tx.commissionRate.create({
      data: { tenantId: ctx.tenantId, memberId: m.id, effectiveFrom: toDate(f.from), bps },
    });
    ctx.upsert("commissionRates", [mapCommissionRate(row)]);
    await ctx.log({
      kind: "team",
      text: `set the commission rate of ${m.name}`,
      target: "Payroll",
      area: "payroll",
      to: `${pct(bps)} from ${f.from}`,
    });
    return `${m.name} earns ${pct(bps)} of what their clients pay, from ${f.from}.`;
  });
}

// ─── commission by hand ────────────────────────────────────────────────────

const ruleForm = z.object({
  memberId: ID,
  clientId: z.string().default(""),
  kind: z.enum(["fixed", "percent"]),
  value: z.union([z.string(), z.number()]),
  repeat: z.enum(["once", "monthly"]).default("once"),
  fromMonth: YM,
  toMonth: z.union([YM, z.literal("")]).default(""),
  note: z.string().trim().max(300).default(""),
});

/** Give anybody a commission: a fixed amount, or a share of one client's money. */
export async function addCommissionRule(raw: z.input<typeof ruleForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll", "edit");
    const f = parse(ctx, ruleForm, raw);
    const m = await memberOf(ctx, f.memberId, "memberId");
    const value = readAmount(f.value);

    if (f.kind === "percent") {
      if (!f.clientId) ctx.fail("A percentage is a share of one client's money - pick the client.", { clientId: "Pick a client." });
      if (!Number.isFinite(value) || value <= 0 || value > 100) ctx.fail("Enter a percentage above 0 and up to 100.", { value: "0 to 100." });
    } else if (!Number.isFinite(value) || value <= 0) {
      ctx.fail("Enter an amount in rupees above zero.", { value: "Above zero." });
    }
    if (f.repeat === "monthly" && f.toMonth && f.toMonth < f.fromMonth) {
      ctx.fail("The last month is before the first.", { toMonth: "Not before the first month." });
    }
    const client = f.clientId ? await clientOf(ctx, f.clientId) : null;

    const row = await ctx.tx.commissionRule.create({
      data: {
        tenantId: ctx.tenantId,
        memberId: m.id,
        clientId: client?.id ?? null,
        kind: f.kind,
        amount: f.kind === "fixed" ? toPaise(value) : 0n,
        bps: f.kind === "percent" ? Math.round(value * 100) : 0,
        repeat: f.repeat,
        fromMonth: toDate(`${f.fromMonth}-01`),
        toMonth: f.repeat === "monthly" && f.toMonth ? toDate(`${f.toMonth}-01`) : null,
        note: f.note,
        createdById: ctx.me.id,
      },
    });
    ctx.upsert("commissionRules", [mapCommissionRule(row)]);
    const what = f.kind === "fixed" ? rs(value) : `${pct(Math.round(value * 100))} of ${client!.name}`;
    await ctx.log({
      kind: "team",
      text: `gave ${m.name} a commission`,
      target: "Payroll",
      area: "payroll",
      to: `${what}${f.repeat === "monthly" ? " every month" : ""} from ${f.fromMonth}`,
    });
    return `Commission added for ${m.name}.`;
  });
}

/**
 * Takes a commission by hand off. Money already paid against it stays paid -
 * that is in the ledger - and it simply stops counting from now on.
 */
export async function removeCommissionRule(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll", "edit");
    const rule = await ctx.tx.commissionRule.findFirst({ where: { id }, include: { member: true } });
    if (!rule) ctx.fail("That commission no longer exists.");
    await ctx.tx.commissionRule.delete({ where: { id } });
    ctx.remove("commissionRules", [id]);
    await ctx.log({ kind: "team", text: `removed a commission of ${rule!.member.name}`, target: "Payroll", area: "payroll" });
    return "Commission removed.";
  });
}

/** Which income categories earn no commission - wallet top-ups, say. */
export async function setCommissionSkip(raw: { categories: string[] }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll", "edit");
    const { categories } = parse(ctx, z.object({ categories: z.array(z.string().max(80)).max(100) }), raw);
    const tenant = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const known = new Set(tenant.incomeCategories);
    const skip = [...new Set(categories)].filter((c) => known.has(c));
    await ctx.tx.tenant.update({ where: { id: ctx.tenantId }, data: { commissionSkip: skip } });
    ctx.tenantPatch({ commissionSkip: skip });
    await ctx.log({
      kind: "team",
      text: "changed which income earns commission",
      target: "Payroll",
      area: "payroll",
      to: skip.length ? `Not: ${skip.join(", ")}` : "All income",
    });
    return "Saved.";
  });
}

// ─── paying ────────────────────────────────────────────────────────────────

/**
 * Pays what is due for a month.
 *
 * "Due" is what has been earned minus what has already been paid for that
 * month. So paying twice pays nothing the second time, and a payment that
 * arrives after the commission was paid shows up as a small amount still due
 * rather than being lost or paid in full again.
 */
export async function payCommission(raw: { memberId: string; ym: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll", "edit");
    const { memberId, ym } = parse(ctx, z.object({ memberId: ID, ym: YM }), raw);
    const m = await memberOf(ctx, memberId, "memberId");
    const { from, to } = monthRange(ym);

    const earned = (await commissionRowFor(ctx.tx, ym, m.id))?.totalPaise ?? 0;
    const already = await ctx.tx.ledgerEntry.aggregate({
      where: { category: CATEGORY, memberId: m.id, type: "out", date: { gte: from, lte: to } },
      _sum: { amount: true },
    });
    const paid = Number(already._sum.amount ?? 0n);
    const due = earned - paid;
    const month = MNF[Number(ym.slice(5)) - 1];
    if (due <= 0) ctx.fail(earned ? `${m.name}'s ${month} commission is already paid.` : `${m.name} has no commission for ${month}.`);

    const categories = await ensureCategory(ctx.tx, ctx.tenantId);
    if (categories) ctx.tenantPatch({ expenseCategories: categories });
    const day = ym === ctx.today.slice(0, 7) ? ctx.today : `${ym}-${String(Math.min(28, daysInMonth(ym))).padStart(2, "0")}`;
    const row = await ctx.tx.ledgerEntry.create({
      data: {
        tenantId: ctx.tenantId,
        type: "out",
        date: toDate(day),
        description: paid ? `Commission, ${m.name}, ${month} (balance)` : `Commission, ${m.name}, ${month}`,
        category: CATEGORY,
        amount: BigInt(due),
        status: "paid",
        memberId: m.id,
        createdById: ctx.me.id,
      },
    });
    await outEntries(ctx, [row.id]);
    await ctx.log({
      kind: "team",
      text: `paid the ${month} commission of ${m.name}`,
      target: "Payroll",
      area: "payroll",
      to: rs(due / 100),
    });
    return `${rs(due / 100)} commission paid to ${m.name} and added to expenses.`;
  });
}

/** Adds "Commissions" to the expense categories the first time; returns the new list if it changed. */
async function ensureCategory(tx: Tx, tenantId: string): Promise<string[] | null> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { expenseCategories: true } });
  if (t.expenseCategories.includes(CATEGORY)) return null;
  const next = [...t.expenseCategories, CATEGORY];
  await tx.tenant.update({ where: { id: tenantId }, data: { expenseCategories: next } });
  return next;
}
