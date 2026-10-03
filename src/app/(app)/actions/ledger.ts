"use server";

import { z } from "zod";
import { canEdit, canLedger, canOverhead } from "@/lib/access";
import { MNF, daysInMonth, fmtCur, readAmount } from "@/lib/format";
import { mutate, type Ctx } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { dateOnly, mapEntry, toDate, toPaise } from "@/lib/workspace";
import { DATE, ID, clientOf, memberOf, needClient, outEntries, outMember, parse, rs } from "@/lib/action-helpers";

const CURS = ["INR", "USD", "USDT", "USDC"] as const;

const entryForm = z.object({
  type: z.enum(["in", "out"]),
  desc: z.string().trim().min(1, "Add a short description.").max(300),
  client: z.string().default(""),
  cat: z.string().trim().min(1, "Pick a category.").max(60),
  amount: z.union([z.string(), z.number()]),
  date: DATE,
  status: z.enum(["paid", "pending"]).default("paid"),
  cur: z.enum(CURS).default("INR"),
  orig: z.union([z.string(), z.number()]).default(""),
  emp: z.string().default(""),
  partner: z.string().default(""),
});

type EntryForm = z.output<typeof entryForm>;

/** Checks a ledger form and returns what to write. Shared by add and edit. */
async function readEntry(ctx: Ctx, f: EntryForm) {
  const amount = readAmount(f.amount);
  const fx = f.type === "in" && f.cur !== "INR";
  const orig = fx ? readAmount(f.orig) : null;
  const fields: Record<string, string> = {};
  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    fields.amount = fx ? "Enter the rupee amount received after conversion." : "Enter an amount above zero, in rupees.";
  }
  if (fx && (!orig || orig <= 0 || !Number.isFinite(orig))) fields.orig = `Enter how much ${f.cur} you received.`;

  let clientId: string | null = null;
  let clientName = "No client";
  if (f.client) {
    const c = await clientOf(ctx, f.client);
    needClient(ctx, c.id, "finance", c.name);
    clientId = c.id;
    clientName = c.name;
  } else if (!canOverhead(ctx.person)) {
    fields.client = "Pick a client you hold Finance access on.";
  }

  const salary = f.type === "out" && f.cat === "Salaries";
  const draw = f.type === "out" && f.cat === "Partner draw";
  if ((salary || draw) && !canEdit(ctx.person, "payroll")) {
    ctx.fail("Salaries and partner draws need Edit access on Payroll.", { cat: "Pick another category." });
  }
  let memberId: string | null = null;
  if (salary) {
    if (!f.emp) fields.emp = "Pick who this salary is for.";
    else memberId = (await memberOf(ctx, f.emp, "emp")).id;
  }
  let partnerId: string | null = null;
  if (draw) {
    const p = f.partner ? await memberOf(ctx, f.partner, "partner") : null;
    if (!p || !p.isOwner) fields.partner = "Pick one of the owners.";
    else partnerId = p.id;
  }

  if (Object.keys(fields).length) ctx.fail(Object.values(fields)[0]!, fields);
  return { amount, fx, orig, clientId, clientName, memberId, partnerId };
}

/** Adds a category the workspace has not used before, so it is offered next time. */
async function rememberCategory(ctx: Ctx, type: "in" | "out", cat: string) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const list = type === "in" ? t.incomeCategories : t.expenseCategories;
  if (list.includes(cat)) return;
  const next = [...list, cat];
  await ctx.tx.tenant.update({
    where: { id: ctx.tenantId },
    data: type === "in" ? { incomeCategories: next } : { expenseCategories: next },
  });
  ctx.tenantPatch(type === "in" ? { incomeCategories: next } : { expenseCategories: next });
}

export async function createEntry(raw: z.input<typeof entryForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("expenses");
    const f = parse(ctx, entryForm, raw);
    const e = await readEntry(ctx, f);
    await rememberCategory(ctx, f.type, f.cat);
    const row = await ctx.tx.ledgerEntry.create({
      data: {
        tenantId: ctx.tenantId,
        type: f.type,
        date: toDate(f.date),
        description: f.desc,
        clientId: e.clientId,
        category: f.cat,
        amount: toPaise(e.amount),
        status: f.status,
        currency: e.fx ? f.cur : null,
        origAmount: e.fx && e.orig ? toPaise(e.orig) : null,
        memberId: e.memberId,
        partnerId: e.partnerId,
        createdById: ctx.me.id,
      },
    });
    ctx.upsert("ledger", [mapEntry(row)]);
    await ctx.log({
      kind: "expense",
      text: `added ${f.type === "in" ? "income" : "expense"} “${f.desc}”`,
      target: e.clientName,
      clientId: e.clientId,
      area: e.clientId ? null : overheadArea(f.cat),
      to: rs(e.amount) + (e.fx && e.orig ? ` (${fmtCur(e.orig, f.cur)})` : ""),
    });
    return `${f.type === "in" ? "Income" : "Expense"} added and recorded in the audit trail.`;
  });
}

/** Overhead entries are read by whoever can see overhead; salary lines by Payroll. */
const overheadArea = (cat: string) => (cat === "Salaries" || cat === "Partner draw" ? "payroll" : "ledger");

async function entryFor(ctx: Ctx, id: string) {
  const e = await ctx.tx.ledgerEntry.findFirst({ where: { id } });
  if (!e || !canLedger(ctx.person, e, ctx.reach.grants)) return ctx.fail("That entry no longer exists.");
  return e;
}

const clientName = async (ctx: Ctx, id: string | null) =>
  id ? ((await ctx.tx.client.findFirst({ where: { id }, select: { name: true } }))?.name ?? "Client") : "No client";

export async function editEntry(raw: z.input<typeof entryForm> & { id: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("expenses");
    const f = parse(ctx, entryForm.extend({ id: ID }), raw);
    const old = await entryFor(ctx, f.id);
    if (old.type !== f.type) ctx.fail("An entry cannot change between income and expense. Delete it and add it again.");
    const e = await readEntry(ctx, f);
    await rememberCategory(ctx, f.type, f.cat);

    // Settling an old pending entry: it counts in the month it was paid.
    const thisMonth = ctx.today.slice(0, 7);
    const paidOn =
      f.status !== "paid"
        ? null
        : old.status === "pending" && f.date.slice(0, 7) < thisMonth
          ? toDate(ctx.today)
          : old.paidOn;

    await ctx.tx.ledgerEntry.update({
      where: { id: old.id },
      data: {
        description: f.desc,
        category: f.cat,
        amount: toPaise(e.amount),
        date: toDate(f.date),
        clientId: e.clientId,
        status: f.status,
        paidOn,
        currency: e.fx ? f.cur : null,
        origAmount: e.fx && e.orig ? toPaise(e.orig) : null,
        memberId: e.memberId,
        partnerId: e.partnerId,
      },
    });
    const amountChanged = toPaise(e.amount) !== old.amount;
    await ctx.log({
      kind: "expense",
      text: amountChanged ? `edited the amount on “${old.description}”` : `edited “${f.desc}”`,
      target: await clientName(ctx, old.clientId),
      clientId: old.clientId,
      area: old.clientId ? null : overheadArea(old.category),
      from: amountChanged ? rs(Number(old.amount) / 100) : "",
      to: amountChanged ? rs(e.amount) : "Details updated",
    });
    await outEntries(ctx, [old.id]);
    return "Changes saved. Previous value kept in the audit trail.";
  });
}

export async function deleteEntry(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("expenses");
    const e = await entryFor(ctx, id);
    if ((e.category === "Salaries" || e.category === "Partner draw") && !e.clientId && !canEdit(ctx.person, "payroll")) {
      ctx.fail("Salaries and partner draws need Edit access on Payroll.");
    }
    await ctx.tx.ledgerEntry.delete({ where: { id } });
    ctx.remove("ledger", [id]);
    await ctx.log({
      kind: "expense",
      text: `deleted “${e.description}”`,
      target: await clientName(ctx, e.clientId),
      clientId: e.clientId,
      area: e.clientId ? null : overheadArea(e.category),
      from: rs(Number(e.amount) / 100),
      to: "Deleted",
    });
    return "Entry deleted. The record stays in the audit trail.";
  });
}

export async function toggleEntryStatus(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("expenses");
    const e = await entryFor(ctx, id);
    const pending = e.status === "pending";
    const to = pending ? "paid" : "pending";
    const late = dateOnly(e.date)!.slice(0, 7) < ctx.today.slice(0, 7);
    await ctx.tx.ledgerEntry.update({
      where: { id },
      data: { status: to, paidOn: to === "paid" && late ? toDate(ctx.today) : null },
    });
    const word = (s: string) => (s === "pending" ? "Pending" : e.type === "in" ? "Received" : "Paid");
    await ctx.log({
      kind: "expense",
      text: `changed the status of “${e.description}”`,
      target: await clientName(ctx, e.clientId),
      clientId: e.clientId,
      area: e.clientId ? null : overheadArea(e.category),
      from: word(e.status),
      to: word(to),
    });
    await outEntries(ctx, [id]);
    return "Status updated.";
  });
}

export async function addCategory(raw: { type: "in" | "out"; name: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("expenses");
    const { type, name } = parse(ctx, z.object({ type: z.enum(["in", "out"]), name: z.string().trim().min(1, "Enter a name.").max(60) }), raw);
    await rememberCategory(ctx, type, name);
    return `${name} added.`;
  });
}

// ──────────────────────────────────────────────────────────────── payroll ───

const YM = z.string().regex(/^\d{4}-\d{2}$/);

async function paySalaryIn(ctx: Ctx, memberId: string, ym: string) {
  const m = await memberOf(ctx, memberId);
  if (!m.salary || m.salary <= 0n) ctx.fail(`${m.name} has no salary set.`);
  const from = toDate(`${ym}-01`);
  const to = toDate(`${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`);
  const existing = await ctx.tx.ledgerEntry.findFirst({
    where: { category: "Salaries", memberId: m.id, date: { gte: from, lte: to } },
  });
  const month = MNF[Number(ym.slice(5)) - 1];
  let id: string;
  if (existing) {
    if (existing.status === "paid") return null;
    await ctx.tx.ledgerEntry.update({ where: { id: existing.id }, data: { status: "paid" } });
    id = existing.id;
  } else {
    const day = ym === ctx.today.slice(0, 7) ? ctx.today : `${ym}-${String(Math.min(28, daysInMonth(ym))).padStart(2, "0")}`;
    const row = await ctx.tx.ledgerEntry.create({
      data: {
        tenantId: ctx.tenantId,
        type: "out",
        date: toDate(day),
        description: `Salary, ${m.name}, ${month}`,
        category: "Salaries",
        amount: m.salary!,
        status: "paid",
        memberId: m.id,
        createdById: ctx.me.id,
      },
    });
    id = row.id;
  }
  await ctx.log({
    kind: "team",
    text: `paid the ${month} salary of ${m.name}`,
    target: "Payroll",
    area: "payroll",
    from: existing ? "Pending" : "Not paid",
    to: rs(Number(existing ? existing.amount : m.salary!) / 100),
  });
  return id;
}

export async function paySalary(raw: { memberId: string; ym: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll");
    const { memberId, ym } = parse(ctx, z.object({ memberId: ID, ym: YM }), raw);
    const id = await paySalaryIn(ctx, memberId, ym);
    if (id) await outEntries(ctx, [id]);
    return "Salary marked as paid and added to expenses.";
  });
}

export async function payAllSalaries(raw: { ym: string; memberIds: string[] }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll");
    const { ym, memberIds } = parse(ctx, z.object({ ym: YM, memberIds: z.array(ID).max(500) }), raw);
    const ids: string[] = [];
    for (const m of memberIds) {
      const id = await paySalaryIn(ctx, m, ym);
      if (id) ids.push(id);
    }
    await outEntries(ctx, ids);
    return `All ${MNF[Number(ym.slice(5)) - 1]} salaries marked as paid.`;
  });
}

const salaryForm = z.object({
  pid: ID,
  salary: z.union([z.string(), z.number()]),
  from: DATE,
  payMethod: z.enum(["bank", "upi"]).default("bank"),
  holder: z.string().trim().max(120).default(""),
  bank: z.string().trim().max(120).default(""),
  acct: z.string().max(40).default(""),
  ifsc: z.string().trim().max(20).default(""),
  upi: z.string().trim().max(120).default(""),
});

const payTo = (p: { payMethod: string | null; payUpi: string | null; payBank: string | null; payAccount: string | null; payIfsc: string | null }) =>
  !p.payMethod
    ? "No bank or UPI details"
    : p.payMethod === "upi"
      ? `UPI · ${p.payUpi || "not set"}`
      : `${p.payBank || "Bank"} · ••••${String(p.payAccount ?? "").slice(-4)}${p.payIfsc ? ` · ${p.payIfsc.toUpperCase()}` : ""}`;

export async function saveSalary(raw: z.input<typeof salaryForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll");
    const f = parse(ctx, salaryForm, raw);
    const amount = readAmount(f.salary);
    const fields: Record<string, string> = {};
    if (!amount || amount <= 0 || !Number.isFinite(amount)) fields.salary = "Enter a monthly salary above zero.";
    if (f.payMethod === "upi" && f.upi && !/^[\w.\-]+@[\w.\-]+$/.test(f.upi)) fields.upi = "Enter a UPI ID like name@bank.";
    const acct = f.acct.replace(/\s/g, "");
    if (f.payMethod === "bank" && acct && !/^\d{6,18}$/.test(acct)) fields.acct = "Account number should be 6 to 18 digits.";
    if (f.payMethod === "bank" && f.ifsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.ifsc)) fields.ifsc = "IFSC is 11 characters, like HDFC0001234.";
    if (Object.keys(fields).length) ctx.fail(Object.values(fields)[0]!, fields);

    const m = await memberOf(ctx, f.pid, "pid");
    const oldPay = payTo(m);
    const pay =
      f.payMethod === "upi"
        ? { payMethod: "upi", payUpi: f.upi, payHolder: null, payBank: null, payAccount: null, payIfsc: null }
        : { payMethod: "bank", payUpi: null, payHolder: f.holder, payBank: f.bank, payAccount: acct, payIfsc: f.ifsc.toUpperCase() };
    const salary = toPaise(amount);
    const changed = salary !== m.salary;

    await ctx.tx.member.update({ where: { id: m.id }, data: { salary, ...pay } });
    if (changed) {
      await ctx.tx.salaryChange.create({ data: { tenantId: ctx.tenantId, memberId: m.id, effectiveFrom: toDate(f.from), amount: salary } });
      await ctx.log({
        kind: "team",
        text: `changed the salary of ${m.name}`,
        target: "Payroll",
        area: "payroll",
        from: m.salary ? rs(Number(m.salary) / 100) : "None",
        to: rs(amount),
      });
    }
    const newPay = payTo(pay);
    if (newPay !== oldPay) {
      await ctx.log({ kind: "team", text: `updated the payment details of ${m.name}`, target: "Payroll", area: "payroll", from: oldPay, to: newPay });
    }
    await outMember(ctx, m.id);
    return `Salary and payment details saved for ${m.name}.`;
  });
}

// ────────────────────────────────────────────────────────── partner draws ───

const drawForm = z.object({
  partner: ID,
  amount: z.union([z.string(), z.number()]),
  date: DATE,
  src: z.string().default(""),
  note: z.string().trim().max(500).default(""),
});

export async function recordDraw(raw: z.input<typeof drawForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll");
    const f = parse(ctx, drawForm, raw);
    const amount = readAmount(f.amount);
    if (!amount || amount <= 0 || !Number.isFinite(amount)) ctx.fail("Enter an amount above zero, in rupees.", { amount: "Enter an amount above zero, in rupees." });
    const p = await memberOf(ctx, f.partner, "partner");
    if (!p.isOwner) ctx.fail("Draws are taken by owners.", { partner: "Pick one of the owners." });
    let src: { id: string; description: string } | null = null;
    if (f.src) {
      const e = await ctx.tx.ledgerEntry.findFirst({ where: { id: f.src, type: "in" } });
      if (!e) ctx.fail("That client payment no longer exists.", { src: "Pick another payment." });
      src = e;
    }
    const row = await ctx.tx.ledgerEntry.create({
      data: {
        tenantId: ctx.tenantId,
        type: "out",
        date: toDate(f.date),
        description: `Partner draw, ${p.name}`,
        category: "Partner draw",
        amount: toPaise(amount),
        status: "paid",
        partnerId: p.id,
        sourceId: src?.id ?? null,
        note: f.note || null,
        createdById: ctx.me.id,
      },
    });
    ctx.upsert("ledger", [mapEntry(row)]);
    await ctx.log({
      kind: "team",
      text: `recorded a partner draw for ${p.name}${src ? ` from “${src.description}”` : ""}`,
      target: "Payroll",
      area: "payroll",
      to: rs(amount),
    });
    return `Draw recorded for ${p.name}.`;
  });
}

export async function deleteDraw(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("payroll");
    const e = await ctx.tx.ledgerEntry.findFirst({ where: { id, category: "Partner draw" } });
    if (!e) return ctx.fail("That draw no longer exists.");
    const p = e.partnerId ? await ctx.tx.member.findFirst({ where: { id: e.partnerId } }) : null;
    await ctx.tx.ledgerEntry.delete({ where: { id } });
    ctx.remove("ledger", [id]);
    await ctx.log({
      kind: "team",
      text: `deleted a partner draw for ${p?.name ?? "a partner"}`,
      target: "Payroll",
      area: "payroll",
      from: rs(Number(e.amount) / 100),
      to: "Deleted",
    });
    return "Draw deleted. The record stays in the audit trail.";
  });
}
