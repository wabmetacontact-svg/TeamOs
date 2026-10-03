import "server-only";
import { z } from "zod";
import { canEditTask, reaches, type Grant } from "./access";
import type { Ctx } from "./mutate";
import {
  mapClient,
  mapEntry,
  mapMember,
  mapSeries,
  mapTask,
  TASK_INCLUDE,
  type MapCtx,
} from "./workspace";

/**
 * Lookups and output shared by the server actions. Every lookup goes through
 * the transaction's tenant-bound client, so "not found" also covers "belongs
 * to another workspace".
 */

export const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
export const OPT_DATE = z.union([DATE, z.literal("")]).optional().default("");
export const ID = z.string().min(1).max(100);

/** Reads the input, or refuses with the first problem in words. */
export function parse<T>(ctx: Ctx, schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? "form");
    fields[k] ??= issue.message;
  }
  return ctx.fail(r.error.issues[0]?.message ?? "Please check the form.", fields);
}

export function mapCtx(ctx: Ctx): MapCtx {
  return { tz: ctx.tz, payroll: ctx.reach.payroll, finance: ctx.reach.financeClient };
}

export async function brandOf(ctx: Ctx, id: string) {
  const b = await ctx.tx.brand.findFirst({ where: { id } });
  return b ?? ctx.fail("That brand no longer exists.", { brand: "Pick a brand." });
}

export async function clientOf(ctx: Ctx, id: string) {
  const c = await ctx.tx.client.findFirst({ where: { id, removedAt: null } });
  if (!c || !ctx.reach.visibleClient(c.id)) return ctx.fail("That client no longer exists.", { client: "Pick a client." });
  return c;
}

export async function memberOf(ctx: Ctx, id: string, field = "who") {
  const m = await ctx.tx.member.findFirst({ where: { id } });
  return m ?? ctx.fail("That team member no longer exists.", { [field]: "Pick someone on the team." });
}

export async function deptOf(ctx: Ctx, id: string) {
  const d = await ctx.tx.taskDepartment.findFirst({ where: { id } });
  return d ?? ctx.fail("That department no longer exists.", { dept: "Pick a department." });
}

export function needClient(ctx: Ctx, clientId: string, level: Grant, label: string) {
  if (!reaches(ctx.person, clientId, level, ctx.reach.grants)) {
    ctx.fail(
      level === "finance"
        ? `You need Finance access on ${label} to do this.`
        : `You have view-only access on ${label}. Nothing was saved.`,
      { client: level === "finance" ? "Pick a client you hold Finance access on." : "You need Edit access on this client." },
    );
  }
}

/** A task's "Working for" value: "" for the brand itself, "@Area", or a client id. */
export function splitFor(v: string): { clientId: string | null; area: string } {
  if (!v) return { clientId: null, area: "" };
  if (v.startsWith("@")) return { clientId: null, area: v.slice(1) };
  return { clientId: v, area: "" };
}

/** "Brand · Client", "Brand · Area" or "Brand · Operations", as the screens tag a task. */
export async function tagOf(ctx: Ctx, t: { brandId: string; clientId: string | null; area: string }) {
  const [b, c] = await Promise.all([
    ctx.tx.brand.findFirst({ where: { id: t.brandId }, select: { name: true } }),
    t.clientId ? ctx.tx.client.findFirst({ where: { id: t.clientId }, select: { name: true } }) : null,
  ]);
  return `${b?.name ?? "Overhead"} · ${c?.name ?? (t.area || "Operations")}`;
}

/** What an audit entry about a task is "about": its client, else its brand. */
export async function taskTarget(ctx: Ctx, t: { brandId: string; clientId: string | null }) {
  if (t.clientId) {
    const c = await ctx.tx.client.findFirst({ where: { id: t.clientId }, select: { name: true } });
    return { target: c?.name ?? "Client", clientId: t.clientId, area: null };
  }
  const b = await ctx.tx.brand.findFirst({ where: { id: t.brandId }, select: { name: true } });
  return { target: b?.name ?? "Tasks", clientId: null, area: "tasks" as const };
}

export async function taskFor(ctx: Ctx, id: string) {
  const t = await ctx.tx.task.findFirst({ where: { id } });
  if (!t) return ctx.fail("That task no longer exists.");
  if (t.clientId && !ctx.reach.visibleClient(t.clientId)) return ctx.fail("That task no longer exists.");
  return t;
}

export function needTaskEdit(ctx: Ctx, t: { clientId: string | null }, label: string) {
  if (!canEditTask(ctx.person, t, ctx.reach.grants)) {
    ctx.fail(`You have View access on ${label}. Nothing was saved.`);
  }
}

// ───────────────────────────────────────────────────────────── output ───

export async function outTasks(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const rows = await ctx.tx.task.findMany({ where: { id: { in: ids } }, include: TASK_INCLUDE });
  ctx.upsert(
    "tasks",
    rows.map((t) => mapTask(t, ctx.tz)),
  );
}

export async function outSeries(ctx: Ctx, id: string) {
  const s = await ctx.tx.taskSeries.findUnique({ where: { id } });
  if (s) ctx.upsert("series", [mapSeries(s)]);
}

export async function outMember(ctx: Ctx, id: string) {
  const [m, salaries] = await Promise.all([
    ctx.tx.member.findUnique({ where: { id } }),
    ctx.reach.payroll ? ctx.tx.salaryChange.findMany({ where: { memberId: id } }) : Promise.resolve([]),
  ]);
  if (m) ctx.upsert("members", [mapMember(m, mapCtx(ctx), salaries)]);
}

export async function outClient(ctx: Ctx, id: string) {
  const [c, rates] = await Promise.all([
    ctx.tx.client.findUnique({ where: { id } }),
    ctx.tx.clientRate.findMany({ where: { clientId: id } }),
  ]);
  if (c) ctx.upsert("clients", [mapClient(c, mapCtx(ctx), rates)]);
}

export async function outEntries(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const rows = await ctx.tx.ledgerEntry.findMany({ where: { id: { in: ids } } });
  ctx.upsert("ledger", rows.map(mapEntry));
}

/** "₹1,23,456" for audit text, from rupees. */
export const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
