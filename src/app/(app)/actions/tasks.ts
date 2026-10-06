"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { canEdit, isTeamAdmin } from "@/lib/access";
import { dLabel, firstLink } from "@/lib/format";
import { DEPT_PALETTE, PRI, statusLabel } from "@/lib/labels";
import { mutate, type Ctx } from "@/lib/mutate";
import { nextOccurrence, occurrencesThrough, ruleText, type Rule } from "@/lib/recurrence";
import type { Result } from "@/lib/types";
import { dateOnly, mapDept, mapSheetCol, occurrenceId, toDate } from "@/lib/workspace";
import {
  DATE,
  ID,
  OPT_DATE,
  brandOf,
  clientOf,
  deptOf,
  memberOf,
  needClient,
  needTaskEdit,
  outSeries,
  outTasks,
  parse,
  splitFor,
  tagOf,
  taskFor,
  taskTarget,
} from "@/lib/action-helpers";

const STATUS = z.enum(["todo", "doing", "review", "blocked", "done"]);
const PRIORITY = z.enum(["high", "medium", "low"]);

/** A department this person may file work under. */
async function allowedDept(ctx: Ctx, id: string) {
  const d = await deptOf(ctx, id);
  const limit = !ctx.person.isOwner && ctx.person.taskDeptIds.length ? ctx.person.taskDeptIds : null;
  if (limit && !limit.includes(d.id)) ctx.fail("You can only add tasks to your own departments.", { dept: "Pick one of your departments." });
  return d;
}

/** Brand + "working for" checked together: a client must be on that brand and editable. */
async function workingFor(ctx: Ctx, brandId: string, value: string) {
  const brand = await brandOf(ctx, brandId);
  const { clientId, area } = splitFor(value);
  if (clientId) {
    const c = await clientOf(ctx, clientId);
    if (c.brandId !== brand.id) ctx.fail("That client belongs to another brand.", { client: "Pick a client of this brand." });
    needClient(ctx, c.id, "edit", c.name);
  }
  return { brand, clientId, area };
}

const hours = (v: string | number | null | undefined) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

// ─────────────────────────────────────────────────────────────── create ───

const newTask = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(300),
  brand: z.string().min(1, "Pick a brand."),
  client: z.string().default(""),
  who: ID,
  by: ID,
  due: OPT_DATE,
  status: STATUS.default("todo"),
  dept: ID,
  pri: PRIORITY.default("medium"),
  est: z.union([z.string(), z.number()]).optional(),
  note: z.string().max(4000).default(""),
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "every"]).default("none"),
  rday: z.coerce.number().int().min(0).max(6).default(1),
  every: z.union([z.string(), z.number()]).default("2"),
  time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]).default(""),
  until: OPT_DATE,
});

export async function createTask(raw: z.input<typeof newTask>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const f = parse(ctx, newTask, raw);
    const { brand, clientId, area } = await workingFor(ctx, f.brand, f.client);
    await memberOf(ctx, f.who, "who");
    await memberOf(ctx, f.by, "by");
    const dept = await allowedDept(ctx, f.dept);
    const est = hours(f.est);
    const target = await taskTarget(ctx, { brandId: brand.id, clientId });

    if (f.repeat !== "none") {
      const every = Math.round(Number(f.every));
      if (f.repeat === "every" && (!every || every < 1)) ctx.fail("Enter a number of days, 1 or more.", { every: "Enter a number of days, 1 or more." });
      const start = f.due || ctx.today;
      if (f.until && f.until < start) ctx.fail("Ends before it starts.", { until: "Ends before it starts." });

      const series = await ctx.tx.taskSeries.create({
        data: {
          tenantId: ctx.tenantId,
          title: f.title,
          brandId: brand.id,
          clientId,
          area,
          assigneeId: f.who,
          createdById: f.by,
          departmentId: dept.id,
          priority: f.pri,
          estimate: est,
          freq: f.repeat,
          weekday: f.repeat === "weekly" ? f.rday : null,
          everyDays: f.repeat === "every" ? every : 1,
          time: f.time || null,
          startDate: toDate(start),
          untilDate: f.until ? toDate(f.until) : null,
        },
      });
      const rule: Rule = {
        freq: f.repeat,
        weekday: series.weekday,
        everyDays: series.everyDays,
        time: series.time,
        start,
        until: f.until || null,
      };
      const ids = await createOccurrences(ctx, series.id, rule, {
        title: f.title,
        brandId: brand.id,
        clientId,
        area,
        assigneeId: f.who,
        assignedById: f.by,
        departmentId: dept.id,
        priority: f.pri,
        estimate: est,
      });
      await outSeries(ctx, series.id);
      await outTasks(ctx, ids);
      await ctx.log({ kind: "task", text: `set up the recurring task “${f.title}”`, ...target, to: ruleText(rule) });
      const next = nextOccurrence(rule, start < ctx.today ? ctx.today : start);
      return `Recurring task set up.${next ? ` Next one: ${dLabel(next)}${rule.time ? ` at ${rule.time}` : ""}.` : ""}`;
    }

    const note = f.note.trim();
    const task = await ctx.tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        title: f.title,
        brandId: brand.id,
        clientId,
        area,
        assigneeId: f.who,
        assignedById: f.by,
        status: f.status,
        departmentId: dept.id,
        due: f.due ? toDate(f.due) : null,
        priority: f.pri,
        estimate: est,
        createdOn: toDate(ctx.today),
        changes: { create: { tenantId: ctx.tenantId, status: f.status, byId: f.by } },
        ...(note ? { notes: { create: { tenantId: ctx.tenantId, byId: ctx.me.id, text: note, link: firstLink(note) || null } } } : {}),
      },
    });
    await outTasks(ctx, [task.id]);
    await ctx.log({ kind: "task", text: `created “${f.title}”`, ...target, to: statusLabel(f.status) });
    return "Task created.";
  });
}

type Template = Omit<Prisma.TaskCreateManyInput, "id" | "tenantId" | "due" | "createdOn" | "seriesId" | "status">;

/** Every occurrence from the series start through today, which a new series owes at once. */
async function createOccurrences(ctx: Ctx, seriesId: string, rule: Rule, t: Template): Promise<string[]> {
  const days = occurrencesThrough(rule, ctx.today);
  if (!days.length) return [];
  const rows = days.map((d) => ({
    ...t,
    id: occurrenceId(seriesId, d),
    tenantId: ctx.tenantId,
    seriesId,
    status: "todo",
    due: toDate(d),
    dueTime: rule.time,
    createdOn: toDate(d),
  }));
  await ctx.tx.task.createMany({ data: rows, skipDuplicates: true });
  await ctx.tx.taskStatusChange.createMany({
    data: rows.map((r) => ({ id: `h_${r.id}`, tenantId: ctx.tenantId, taskId: r.id, status: "todo", byId: t.assignedById })),
    skipDuplicates: true,
  });
  return rows.map((r) => r.id);
}

// ───────────────────────────────────────────────────────── edit (drawer) ───

const draft = z.object({
  id: ID,
  status: STATUS,
  who: ID,
  by: z.string().default(""),
  hours: z.union([z.string(), z.number()]).default(0),
  due: OPT_DATE,
  pri: PRIORITY,
  est: z.union([z.string(), z.number(), z.null()]).optional(),
  brand: ID,
  client: z.string().default(""),
  dept: ID,
});

export async function saveTask(raw: z.input<typeof draft>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const d = parse(ctx, draft, raw);
    const t = await taskFor(ctx, d.id);
    const before = await taskTarget(ctx, t);
    needTaskEdit(ctx, t, before.target);

    const { brand, clientId, area } =
      d.brand !== t.brandId || splitFor(d.client).clientId !== t.clientId || splitFor(d.client).area !== t.area
        ? await workingFor(ctx, d.brand, d.client)
        : { brand: { id: t.brandId }, clientId: t.clientId, area: t.area };
    if (d.who !== t.assigneeId) await memberOf(ctx, d.who, "who");
    if (d.by && d.by !== t.assignedById) await memberOf(ctx, d.by, "by");
    if (d.dept !== t.departmentId) await allowedDept(ctx, d.dept);

    const h = Math.max(0, Number(d.hours) || 0);
    const est = hours(d.est ?? "");
    const due = d.due || null;
    const changes: { text: string; from: string; to: string }[] = [];

    if (d.status !== t.status) changes.push({ text: `moved “${t.title}”`, from: statusLabel(t.status), to: statusLabel(d.status) });
    if (d.who !== t.assigneeId) {
      const [a, b] = await Promise.all([memberOf(ctx, t.assigneeId), memberOf(ctx, d.who)]);
      changes.push({ text: `reassigned “${t.title}”`, from: a.name, to: b.name });
    }
    if (brand.id !== t.brandId || clientId !== t.clientId || area !== t.area) {
      changes.push({
        text: `changed who “${t.title}” is for`,
        from: await tagOf(ctx, t),
        to: await tagOf(ctx, { brandId: brand.id, clientId, area }),
      });
    }
    if (due !== dateOnly(t.due)) changes.push({ text: `changed the due date on “${t.title}”`, from: dLabel(dateOnly(t.due)), to: dLabel(due) });
    if (d.pri !== t.priority) {
      changes.push({ text: `changed the priority of “${t.title}”`, from: PRI[t.priority as keyof typeof PRI]?.[0] ?? t.priority, to: PRI[d.pri][0] });
    }
    const oldEst = t.estimate == null ? null : Number(t.estimate);
    if (est !== oldEst) changes.push({ text: `changed the estimate on “${t.title}”`, from: oldEst ? `${oldEst}h` : "None", to: est ? `${est}h` : "None" });
    if (d.dept !== t.departmentId) {
      const [a, b] = await Promise.all([deptOf(ctx, t.departmentId), deptOf(ctx, d.dept)]);
      changes.push({ text: `moved “${t.title}” to another department`, from: a.name, to: b.name });
    }
    if (h !== Number(t.hours)) changes.push({ text: `logged hours on “${t.title}”`, from: `${Number(t.hours)}h`, to: `${h}h` });

    if (!changes.length) return "No changes to save.";

    await ctx.tx.task.update({
      where: { id: t.id },
      data: {
        status: d.status,
        assigneeId: d.who,
        assignedById: d.by || t.assignedById,
        hours: h,
        due: due ? toDate(due) : null,
        priority: d.pri,
        estimate: est,
        brandId: brand.id,
        clientId,
        area,
        departmentId: d.dept,
        ...(d.status !== t.status ? { changes: { create: { tenantId: ctx.tenantId, status: d.status, byId: ctx.me.id } } } : {}),
      },
    });
    const target = await taskTarget(ctx, { brandId: brand.id, clientId });
    for (const c of changes) await ctx.log({ kind: "task", ...target, ...c });
    await outTasks(ctx, [t.id]);
    return "Saved.";
  });
}

// ─────────────────────────────────────────────────────── sheet (inline) ───

const cell = z.object({ id: ID, key: z.string().min(1).max(120), value: z.string().max(4000) });

const BASE_KEYS = ["title", "who", "by", "dept", "status", "pri", "due", "est"] as const;

export async function setTaskCell(raw: z.input<typeof cell>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const { id, key, value } = parse(ctx, cell, raw);
    const t = await taskFor(ctx, id);
    const target = await taskTarget(ctx, t);
    needTaskEdit(ctx, t, target.target);

    if (key.startsWith("c:")) {
      const colId = key.slice(2);
      const col = await ctx.tx.sheetColumn.findFirst({ where: { id: colId } });
      if (!col) ctx.fail("That column no longer exists.");
      const custom = { ...((t.custom ?? {}) as Record<string, string>), [colId]: value.slice(0, 500) };
      await ctx.tx.task.update({ where: { id }, data: { custom } });
      await outTasks(ctx, [id]);
      return;
    }
    if (!(BASE_KEYS as readonly string[]).includes(key)) ctx.fail("That column cannot be edited.");

    const data: Prisma.TaskUncheckedUpdateInput = {};
    let from = "";
    let to = value;
    switch (key as (typeof BASE_KEYS)[number]) {
      case "title":
        data.title = value.trim().slice(0, 300);
        break;
      case "who": {
        const [a, b] = await Promise.all([memberOf(ctx, t.assigneeId), memberOf(ctx, value)]);
        data.assigneeId = b.id;
        [from, to] = [a.name, b.name];
        break;
      }
      case "by":
        if (value) await memberOf(ctx, value, "by");
        data.assignedById = value || t.assignedById;
        break;
      case "dept": {
        const [a, b] = await Promise.all([deptOf(ctx, t.departmentId), allowedDept(ctx, value)]);
        data.departmentId = b.id;
        [from, to] = [a.name, b.name];
        break;
      }
      case "status": {
        const s = STATUS.safeParse(value);
        if (!s.success) return ctx.fail("Pick a status.");
        data.status = s.data;
        if (s.data !== t.status) data.changes = { create: { tenantId: ctx.tenantId, status: s.data, byId: ctx.me.id } };
        [from, to] = [statusLabel(t.status), statusLabel(s.data)];
        break;
      }
      case "pri": {
        const p = PRIORITY.safeParse(value);
        if (!p.success) return ctx.fail("Pick a priority.");
        data.priority = p.data;
        [from, to] = [PRI[t.priority as keyof typeof PRI]?.[0] ?? t.priority, PRI[p.data][0]];
        break;
      }
      case "due":
        if (value && !DATE.safeParse(value).success) ctx.fail("Pick a date.");
        data.due = value ? toDate(value) : null;
        [from, to] = [dLabel(dateOnly(t.due)), dLabel(value || null)];
        break;
      case "est":
        data.estimate = hours(value);
        break;
    }
    await ctx.tx.task.update({ where: { id }, data });

    const logged = { status: "status", who: "assignee", due: "due date", pri: "priority", dept: "department" } as Record<string, string>;
    if (logged[key] && from !== to) {
      await ctx.log({ kind: "task", text: `edited the ${logged[key]} on “${t.title || "Untitled task"}”`, ...target, from, to });
    }
    await outTasks(ctx, [id]);
  });
}

/** "+ New row" in the sheet: an empty task for the person adding it. */
export async function addSheetRow(): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const [brand, dept] = await Promise.all([
      ctx.tx.brand.findFirst({ orderBy: { createdAt: "asc" } }),
      ctx.tx.taskDepartment.findFirst({
        where: !ctx.person.isOwner && ctx.person.taskDeptIds.length ? { id: { in: ctx.person.taskDeptIds } } : {},
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    if (!brand) return ctx.fail("Add a brand first. Tasks belong to a brand.");
    if (!dept) return ctx.fail("Add a task department first.");
    const task = await ctx.tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        title: "",
        brandId: brand.id,
        assigneeId: ctx.me.id,
        assignedById: ctx.me.id,
        departmentId: dept.id,
        due: toDate(ctx.today),
        createdOn: toDate(ctx.today),
        changes: { create: { tenantId: ctx.tenantId, status: "todo", byId: ctx.me.id } },
      },
    });
    await outTasks(ctx, [task.id]);
  });
}

// ──────────────────────────────────────────────────── verify and notes ───

export async function toggleVerify(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can verify tasks.");
    const t = await taskFor(ctx, id);
    if (t.status !== "done") ctx.fail("Only completed tasks can be verified.");
    await ctx.tx.task.update({ where: { id }, data: { verified: !t.verified } });
    await ctx.log({
      kind: "task",
      text: `${t.verified ? "removed verification on" : "verified"} “${t.title}”`,
      ...(await taskTarget(ctx, t)),
      from: t.verified ? "Verified" : "Unverified",
      to: t.verified ? "Unverified" : "Verified",
    });
    await outTasks(ctx, [id]);
    return t.verified ? "Verification removed." : "Task verified.";
  });
}

export async function addNote(raw: { id: string; text: string }): Promise<Result> {
  return mutate(async (ctx) => {
    const { id, text } = parse(ctx, z.object({ id: ID, text: z.string().trim().min(1, "Write a note first.").max(4000) }), raw);
    const t = await taskFor(ctx, id);
    const target = await taskTarget(ctx, t);
    const mine = t.assigneeId === ctx.me.id;
    if (!mine && !(canEdit(ctx.person, "tasks") && (!t.clientId || ctx.reach.visibleClient(t.clientId)))) {
      needTaskEdit(ctx, t, target.target);
    }
    const link = firstLink(text);
    await ctx.tx.taskNote.create({ data: { tenantId: ctx.tenantId, taskId: id, byId: ctx.me.id, text, link: link || null } });
    await ctx.log({ kind: "task", text: `added a note to “${t.title}”`, ...target, to: link ? "Note with link" : "Note" });
    await outTasks(ctx, [id]);
    return "Note added.";
  });
}

// ─────────────────────────────────────────────────────────────── series ───

export async function toggleSeries(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    const s = await ctx.tx.taskSeries.findFirst({ where: { id } });
    if (!s || (s.clientId && !ctx.reach.visibleClient(s.clientId))) return ctx.fail("That recurring task no longer exists.");
    const may = isTeamAdmin(ctx.person) || s.assigneeId === ctx.me.id || s.createdById === ctx.me.id;
    if (!may) ctx.fail("Only its assignee, whoever set it up, or a team admin can stop or resume it.");

    const on = !s.active;
    const rule = (until: string | null): Rule => ({
      freq: s.freq as Rule["freq"],
      weekday: s.weekday,
      everyDays: s.everyDays,
      time: s.time,
      start: dateOnly(s.startDate)!,
      until,
      skip: s.skipDates.map((d) => dateOnly(d)!),
    });
    await ctx.tx.taskSeries.update({
      where: { id },
      data: { active: on, untilDate: on ? null : toDate(ctx.today) },
    });
    const target = await taskTarget(ctx, s);
    await ctx.log({
      kind: "task",
      text: `${on ? "resumed" : "stopped"} the recurring task “${s.title}”`,
      ...target,
      from: on ? "Stopped" : ruleText(rule(dateOnly(s.untilDate))),
      to: on ? ruleText(rule(null)) : "Stopped",
    });
    if (on) {
      const ids = await createOccurrences(ctx, s.id, rule(null), {
        title: s.title,
        brandId: s.brandId,
        clientId: s.clientId,
        area: s.area,
        assigneeId: s.assigneeId,
        assignedById: s.createdById,
        departmentId: s.departmentId ?? (await ctx.tx.taskDepartment.findFirstOrThrow({ orderBy: { position: "asc" } })).id,
        priority: s.priority,
        estimate: s.estimate,
      });
      await outTasks(ctx, ids);
    }
    await outSeries(ctx, id);
    return on ? "Recurring task resumed." : "Recurring task stopped. Existing tasks stay.";
  });
}

// ───────────────────────────────────────────────────────────── delete ───

/**
 * Deletes a task, its notes and its history.
 *
 * For a task that repeats, `scope` says what goes:
 *   "one"     this occurrence only. Its day is remembered on the series, or
 *             the next load would make it again.
 *   "series"  the repeating itself, and every occurrence not yet done. Done
 *             ones stay: they are a record of work that happened.
 */
export async function deleteTask(raw: { id: string; scope?: "one" | "series" }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const t = await taskFor(ctx, String(raw?.id ?? ""));
    const target = await taskTarget(ctx, t);
    needTaskEdit(ctx, t, target.target);

    if (raw?.scope === "series" && t.seriesId) {
      const s = await ctx.tx.taskSeries.findFirstOrThrow({ where: { id: t.seriesId } });
      const may = isTeamAdmin(ctx.person) || s.assigneeId === ctx.me.id || s.createdById === ctx.me.id;
      if (!may) ctx.fail("Only its assignee, whoever set it up, or a team admin can delete a recurring task.");
      const open = await ctx.tx.task.findMany({ where: { seriesId: s.id, status: { not: "done" } }, select: { id: true } });
      const done = await ctx.tx.task.findMany({ where: { seriesId: s.id, status: "done" }, select: { id: true } });
      await ctx.tx.task.deleteMany({ where: { id: { in: open.map((x) => x.id) } } });
      // Done occurrences lose their link to the series (onDelete: SetNull) and stay.
      await ctx.tx.taskSeries.delete({ where: { id: s.id } });
      ctx.remove("tasks", open.map((x) => x.id));
      ctx.remove("series", [s.id]);
      if (done.length) await outTasks(ctx, done.map((x) => x.id));
      await ctx.log({ kind: "task", text: `deleted the recurring task “${s.title}”`, ...target, from: `${open.length} open`, to: "Deleted" });
      return open.length === 1 ? "Recurring task deleted." : `Recurring task deleted, with ${open.length} open tasks.`;
    }

    await ctx.tx.task.delete({ where: { id: t.id } });
    ctx.remove("tasks", [t.id]);
    if (t.seriesId && t.due) {
      await ctx.tx.taskSeries.update({ where: { id: t.seriesId }, data: { skipDates: { push: t.due } } });
      await outSeries(ctx, t.seriesId);
    }
    await ctx.log({ kind: "task", text: `deleted the task “${t.title}”`, ...target, from: statusLabel(t.status), to: "Deleted" });
    return "Task deleted.";
  });
}

// ─────────────────────────────────────────────────── sheet columns ───

export async function addSheetColumn(): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const n = await ctx.tx.sheetColumn.count();
    const col = await ctx.tx.sheetColumn.create({ data: { tenantId: ctx.tenantId, name: `Column ${n + 1}`, position: n } });
    ctx.upsert("sheetCols", [mapSheetCol(col)]);
  });
}

export async function renameSheetColumn(raw: { id: string; name: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const { id, name } = parse(ctx, z.object({ id: ID, name: z.string().max(60) }), raw);
    const col = await ctx.tx.sheetColumn.update({ where: { id }, data: { name } });
    ctx.upsert("sheetCols", [mapSheetCol(col)]);
  });
}

export async function removeSheetColumn(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    await ctx.tx.sheetColumn.delete({ where: { id } });
    ctx.remove("sheetCols", [id]);
  });
}

// ─────────────────────────────────────────────── task departments, areas ───

export async function addTaskDept(raw: { name: string }): Promise<Result<{ id: string }>> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const { name } = parse(ctx, z.object({ name: z.string().trim().min(1, "Enter a name.").max(60) }), raw);
    const all = await ctx.tx.taskDepartment.findMany();
    if (all.some((d) => d.name.toLowerCase() === name.toLowerCase())) ctx.fail("That department already exists.");
    const d = await ctx.tx.taskDepartment.create({
      data: { tenantId: ctx.tenantId, name, color: DEPT_PALETTE[all.length % DEPT_PALETTE.length]!, position: all.length },
    });
    ctx.upsert("depts", [mapDept(d)]);
    await ctx.log({ kind: "task", text: `added the task department “${name}”`, target: "Tasks", area: "tasks", to: name });
    return { message: `${name} added.`, data: { id: d.id } };
  });
}

export async function removeTaskDept(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    if (!ctx.person.isOwner) ctx.fail("Only an owner can remove a department.");
    const d = await deptOf(ctx, id);
    const total = await ctx.tx.taskDepartment.count();
    if (total <= 1) ctx.fail("Keep at least one department.");
    const n = await ctx.tx.task.count({ where: { departmentId: id } });
    if (n) ctx.fail(`${n} ${n === 1 ? "task is" : "tasks are"} in ${d.name}. Move them to another department first.`);
    await ctx.tx.taskDepartment.delete({ where: { id } });
    ctx.remove("depts", [id]);
    await ctx.log({ kind: "task", text: `removed the task department “${d.name}”`, target: "Tasks", area: "tasks", from: d.name });
    return `${d.name} removed.`;
  });
}

export async function addArea(raw: { brandId: string; name: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("tasks");
    const { brandId, name } = parse(ctx, z.object({ brandId: ID, name: z.string().trim().min(1, "Enter a name.").max(60) }), raw);
    const b = await brandOf(ctx, brandId);
    if (b.areas.some((a) => a.toLowerCase() === name.toLowerCase())) ctx.fail("That area already exists.");
    const updated = await ctx.tx.brand.update({ where: { id: b.id }, data: { areas: [...b.areas, name] } });
    ctx.upsert("brands", [{ id: updated.id, name: updated.name, kind: updated.kind === "startup" ? "startup" : "agency", areas: updated.areas }]);
    return `${name} added.`;
  });
}
