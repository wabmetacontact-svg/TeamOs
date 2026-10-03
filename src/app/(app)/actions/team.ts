"use server";

import { z } from "zod";
import { PRESETS, isTeamAdmin } from "@/lib/access";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { dayDiff, readAmount } from "@/lib/format";
import { EMPLOYMENT_TYPES, HR_STATUSES, LEAVE_TYPES } from "@/lib/labels";
import { LINK_TTL_DAYS, linkUrl, newToken } from "@/lib/links";
import { mutate, type Ctx } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { mapLeave, toDate, toPaise } from "@/lib/workspace";
import { DATE, ID, OPT_DATE, memberOf, outMember, parse, rs } from "@/lib/action-helpers";

const EMAIL = z.union([z.string().trim().toLowerCase().email("Enter a valid email address."), z.literal("")]).default("");

async function emailFree(ctx: Ctx, email: string, exceptId?: string) {
  if (!email) return;
  const clash = await ctx.tx.member.findFirst({ where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) ctx.fail(`${clash.name} already uses that email.`, { email: "Already used by someone on the team." });
}

async function makeLink(ctx: Ctx, memberId: string): Promise<string> {
  const { token, tokenHash } = newToken();
  // A new link replaces any unused one, so only the latest works.
  await ctx.tx.loginLink.updateMany({ where: { memberId, usedAt: null }, data: { expiresAt: new Date() } });
  await ctx.tx.loginLink.create({
    data: {
      tenantId: ctx.tenantId,
      memberId,
      tokenHash,
      createdById: ctx.me.id,
      expiresAt: new Date(Date.now() + LINK_TTL_DAYS * 864e5),
    },
  });
  return linkUrl(token);
}

// ───────────────────────────────────────────────────────────── members ───

const memberForm = z.object({
  name: z.string().trim().min(1, "Enter a full name.").max(120),
  role: z.string().trim().min(1, "Add a role.").max(120),
  dept: z.string().trim().max(60).default(""),
  brand: z.string().default(""),
  type: z.enum(EMPLOYMENT_TYPES).default("Full-time"),
  start: OPT_DATE,
  salary: z.union([z.string(), z.number()]).default(""),
  email: EMAIL,
});

export async function createMember(raw: z.input<typeof memberForm>): Promise<Result<{ id: string; link: string | null }>> {
  return mutate(async (ctx) => {
    ctx.need("team");
    const f = parse(ctx, memberForm, raw);
    await emailFree(ctx, f.email);
    const salary = f.salary === "" ? 0 : readAmount(f.salary);
    if (!Number.isFinite(salary) || salary < 0) ctx.fail("Enter a monthly amount in rupees.", { salary: "Enter a monthly amount in rupees." });
    if (salary > 0 && !ctx.reach.payroll) ctx.fail("Setting a salary needs access to Payroll.", { salary: "Leave empty, or ask someone with Payroll." });
    const brand = f.brand ? await ctx.tx.brand.findFirst({ where: { id: f.brand } }) : null;
    const start = f.start || ctx.today;

    const m = await ctx.tx.member.create({
      data: {
        tenantId: ctx.tenantId,
        name: f.name,
        title: f.role,
        email: f.email || null,
        features: PRESETS.Member,
        department: f.dept || null,
        brandId: brand?.id ?? null,
        employmentType: f.type,
        startDate: toDate(start),
        hrStatus: f.type === "Intern" || f.type === "Contract" ? "Probation" : "Active",
        salary: salary > 0 ? toPaise(salary) : null,
        leaveTotal: f.type === "Intern" ? 6 : 18,
        managerId: ctx.me.id,
        ...(salary > 0 ? { salaryChanges: { create: { tenantId: ctx.tenantId, effectiveFrom: toDate(start), amount: toPaise(salary) } } } : {}),
      },
    });
    const link = m.email ? await makeLink(ctx, m.id) : null;
    await outMember(ctx, m.id);
    await ctx.log({ kind: "team", text: `added team member ${m.name}`, target: "Team", area: "team", to: f.role });
    return {
      message: `${m.name} added to the team.`,
      data: { id: m.id, link },
    };
  });
}

const editForm = memberForm.extend({
  id: ID,
  phone: z.string().trim().max(40).default(""),
  manager: z.string().default(""),
  type: z.enum(EMPLOYMENT_TYPES).default("Full-time"),
});

export async function editMember(raw: z.input<typeof editForm>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("team");
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can change profiles.");
    const f = parse(ctx, editForm, raw);
    const old = await memberOf(ctx, f.id);
    if (old.isOwner && !ctx.person.isOwner) ctx.fail("Only an owner can edit an owner's profile.");
    await emailFree(ctx, f.email, old.id);
    if (f.manager && f.manager === old.id) ctx.fail("Someone cannot report to themselves.", { manager: "Pick someone else." });
    if (f.manager) await memberOf(ctx, f.manager, "manager");

    // Salary is Payroll's business: only someone who can see it can change it.
    let salary = old.salary;
    if (ctx.reach.payroll) {
      const n = f.salary === "" ? null : readAmount(f.salary);
      if (n != null && (!Number.isFinite(n) || n < 0)) ctx.fail("Enter a monthly amount in rupees.", { salary: "Enter a monthly amount in rupees." });
      salary = n ? toPaise(n) : null;
    }
    const salaryChanged = salary !== old.salary;
    if (salaryChanged && salary) {
      await ctx.tx.salaryChange.create({ data: { tenantId: ctx.tenantId, memberId: old.id, effectiveFrom: toDate(ctx.today), amount: salary } });
    }

    await ctx.tx.member.update({
      where: { id: old.id },
      data: {
        name: f.name,
        title: f.role,
        department: f.dept || null,
        brandId: f.brand || null,
        employmentType: f.type,
        startDate: f.start ? toDate(f.start) : old.startDate,
        email: f.email || null,
        phone: f.phone || null,
        managerId: f.manager || null,
        salary,
      },
    });
    await outMember(ctx, old.id);
    await ctx.log({
      kind: "team",
      text: `edited the profile of ${f.name}`,
      target: "Team",
      area: salaryChanged ? "payroll" : "team",
      from: salaryChanged ? rs(Number(old.salary ?? 0n) / 100) : "",
      to: salaryChanged ? rs(Number(salary ?? 0n) / 100) : "Profile updated",
    });
    return "Profile saved.";
  });
}

export async function setMemberStatus(raw: { id: string; status: string }): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can change employment status.");
    const { id, status } = parse(ctx, z.object({ id: ID, status: z.enum(HR_STATUSES) }), raw);
    const m = await memberOf(ctx, id);
    if (m.isOwner) ctx.fail("An owner's status cannot be changed here.");
    if (m.id === ctx.me.id) ctx.fail("You cannot change your own status.");
    await ctx.tx.member.update({ where: { id }, data: { hrStatus: status } });
    // Leaving ends every session at once rather than at the next expiry.
    if (status === "Exited") await ctx.tx.session.updateMany({ where: { memberId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await outMember(ctx, id);
    await ctx.log({ kind: "team", text: `changed the status of ${m.name}`, target: "Team", area: "team", from: m.hrStatus, to: status });
    return "Status updated.";
  });
}

export async function setTaskBoards(raw: { id: string; deptIds: string[] }): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can change task boards.");
    const { id, deptIds } = parse(ctx, z.object({ id: ID, deptIds: z.array(ID).max(100) }), raw);
    const m = await memberOf(ctx, id);
    if (m.isOwner) ctx.fail("An owner always sees every board.");
    const depts = await ctx.tx.taskDepartment.findMany();
    const valid = deptIds.filter((d) => depts.some((x) => x.id === d));
    const name = (ids: string[]) => (ids.length ? ids.map((i) => depts.find((d) => d.id === i)?.name ?? "").join(", ") : "All");
    await ctx.tx.member.update({ where: { id }, data: { taskDeptIds: valid } });
    await outMember(ctx, id);
    await ctx.log({ kind: "access", text: `changed task boards for ${m.name}`, target: "Tasks", area: "tasks", from: name(m.taskDeptIds), to: name(valid) });
  });
}

/**
 * Taking somebody off the team.
 *
 * Somebody added by mistake is deleted outright. Somebody who has already done
 * work is not: their name is on tasks, on money and in the audit trail, and
 * erasing the person would leave all of it unattributed. They are marked
 * Exited instead, which ends their access and keeps the history honest.
 */
export async function removeMember(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can remove people.");
    const m = await memberOf(ctx, id);
    if (m.id === ctx.me.id) ctx.fail("You cannot remove yourself.");
    if (m.isOwner) {
      if (!ctx.person.isOwner) ctx.fail("Only an owner can remove another owner.");
      const owners = await ctx.tx.member.count({ where: { isOwner: true, hrStatus: { not: "Exited" } } });
      if (owners <= 1) ctx.fail("This is the last owner. Make somebody else an owner first.");
    }

    const [tasks, notes, changes, series, ledger] = await Promise.all([
      ctx.tx.task.count({ where: { OR: [{ assigneeId: id }, { assignedById: id }] } }),
      ctx.tx.taskNote.count({ where: { byId: id } }),
      ctx.tx.taskStatusChange.count({ where: { byId: id } }),
      ctx.tx.taskSeries.count({ where: { OR: [{ assigneeId: id }, { createdById: id }] } }),
      ctx.tx.ledgerEntry.count({ where: { createdById: id } }),
    ]);
    const attached = [
      tasks && `${tasks} ${tasks === 1 ? "task" : "tasks"}`,
      series && `${series} recurring ${series === 1 ? "task" : "tasks"}`,
      ledger && `${ledger} ledger ${ledger === 1 ? "entry" : "entries"}`,
      notes + changes && "task history",
    ].filter(Boolean) as string[];

    if (attached.length) {
      ctx.fail(
        `${m.name} is on ${attached.join(", ")}. Deleting them would leave that work unattributed — set their status to Exited instead, which ends their access and keeps their name on what they did.`,
      );
    }

    // Sessions, login links, grants and leave go with them; nothing else points here.
    await ctx.tx.member.delete({ where: { id } });
    ctx.remove("members", [id]);
    await ctx.log({ kind: "team", text: `removed ${m.name} from the team`, target: "Team", area: "team", from: m.title, to: "Removed" });
    return `${m.name} removed.`;
  });
}

/**
 * Setting a password.
 *
 * An owner or team admin can set somebody else's — useful when there is no
 * mail server and a link is awkward. Changing your own needs the current one,
 * so a borrowed laptop cannot lock you out of your own workspace.
 *
 * Either way every other session for that person ends, and any login link
 * waiting to be used stops working.
 */
export async function setMemberPassword(raw: { memberId: string; current?: string; password: string; confirm: string }): Promise<Result> {
  return mutate(async (ctx) => {
    const f = parse(
      ctx,
      z.object({
        memberId: ID,
        current: z.string().default(""),
        password: z.string().min(8, "Use at least 8 characters."),
        confirm: z.string(),
      }),
      raw,
    );
    if (f.confirm !== f.password) ctx.fail("Passwords do not match.", { confirm: "Passwords do not match." });

    const m = await memberOf(ctx, f.memberId);
    const self = m.id === ctx.me.id;

    if (self) {
      if (!ctx.me.passwordHash || !(await verifyPassword(ctx.me.passwordHash, f.current))) {
        ctx.fail("That is not your current password.", { current: "That is not your current password." });
      }
    } else {
      if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can set a password.");
      if (m.isOwner && !ctx.person.isOwner) ctx.fail("Only an owner can set another owner's password.");
      if (m.hrStatus === "Exited") ctx.fail(`${m.name} has exited. Change their status first.`);
      if (!m.email) ctx.fail(`Add an email for ${m.name} first. It is what they log in with.`);
    }

    await ctx.tx.member.update({ where: { id: m.id }, data: { passwordHash: await hashPassword(f.password) } });
    await ctx.tx.loginLink.updateMany({ where: { memberId: m.id, usedAt: null }, data: { expiresAt: new Date() } });
    // Every other session ends; the one doing this keeps going.
    await ctx.tx.session.updateMany({
      where: { memberId: m.id, revokedAt: null, ...(self ? { id: { not: ctx.signed.sessionId } } : {}) },
      data: { revokedAt: new Date() },
    });

    await outMember(ctx, m.id);
    await ctx.log({
      kind: "team",
      text: self ? "changed their own password" : `set a new password for ${m.name}`,
      target: "Team",
      area: "team",
      to: self ? "Changed" : "Set by an admin",
    });
    return self ? "Your password is changed." : `Password set for ${m.name}. Send it to them the way you would send a password.`;
  });
}

/** A one-time link the member opens to set a password. Replaces any older one. */
export async function createLoginLink(id: string): Promise<Result<{ link: string }>> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can make login links.");
    const m = await memberOf(ctx, id);
    if (m.isOwner && !ctx.person.isOwner) ctx.fail("Only an owner can make a login link for another owner.");
    if (m.hrStatus === "Exited") ctx.fail(`${m.name} has exited. Change their status first.`);
    if (!m.email) ctx.fail(`Add an email for ${m.name} first. It is what they log in with.`);
    const link = await makeLink(ctx, m.id);
    await ctx.log({ kind: "team", text: `created a login link for ${m.name}`, target: "Team", area: "team", to: `Valid ${LINK_TTL_DAYS} days` });
    return { message: "Login link ready.", data: { link } };
  });
}

// ───────────────────────────────────────────────────────── departments ───

export async function addHrDept(raw: { name: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("team");
    const { name } = parse(ctx, z.object({ name: z.string().trim().min(1, "Enter a name.").max(60) }), raw);
    const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if (t.hrDepartments.some((d) => d.toLowerCase() === name.toLowerCase())) ctx.fail("That department already exists.");
    const next = [...t.hrDepartments, name];
    await ctx.tx.tenant.update({ where: { id: ctx.tenantId }, data: { hrDepartments: next } });
    ctx.tenantPatch({ hrDepartments: next });
    return `${name} added.`;
  });
}

export async function removeHrDept(raw: { name: string }): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Only an owner or someone with Edit on Team can remove a department.");
    const { name } = parse(ctx, z.object({ name: z.string().min(1) }), raw);
    const n = await ctx.tx.member.count({ where: { department: name, hrStatus: { not: "Exited" } } });
    if (n) ctx.fail(`${n} ${n === 1 ? "member is" : "members are"} in ${name}. Move them to another department first.`);
    const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const next = t.hrDepartments.filter((d) => d !== name);
    await ctx.tx.tenant.update({ where: { id: ctx.tenantId }, data: { hrDepartments: next } });
    ctx.tenantPatch({ hrDepartments: next });
    await ctx.log({ kind: "team", text: `removed the department “${name}”`, target: "Team", area: "team", from: name });
    return `${name} removed.`;
  });
}

// ─────────────────────────────────────────────────────────────── leave ───

const leaveForm = z.object({
  who: ID,
  type: z.enum(LEAVE_TYPES).default("Annual"),
  from: DATE,
  to: DATE,
  note: z.string().trim().max(500).default(""),
});

export async function requestLeave(raw: z.input<typeof leaveForm>): Promise<Result> {
  return mutate(async (ctx) => {
    const f = parse(ctx, leaveForm, raw);
    // Anyone can ask for their own leave; asking for someone else is running the team.
    if (f.who !== ctx.me.id && !isTeamAdmin(ctx.person)) ctx.fail("You can only request leave for yourself.", { who: "You can only request leave for yourself." });
    if (f.to < f.from) ctx.fail("End date is before the start date.", { to: "End date is before the start date." });
    const m = await memberOf(ctx, f.who, "who");
    const l = await ctx.tx.leave.create({
      data: { tenantId: ctx.tenantId, memberId: m.id, type: f.type, fromDate: toDate(f.from), toDate: toDate(f.to), note: f.note || "No note" },
    });
    ctx.upsert("leaves", [mapLeave(l)]);
    await ctx.log({ kind: "team", text: `requested ${f.type.toLowerCase()} leave for ${m.name}`, target: "Team", area: "team", to: "Pending" });
    return "Leave request submitted.";
  });
}

export async function decideLeave(raw: { id: string; approve: boolean }): Promise<Result> {
  return mutate(async (ctx) => {
    if (!isTeamAdmin(ctx.person)) ctx.fail("Leave is decided by an owner or someone with Edit on Team.");
    const { id, approve } = parse(ctx, z.object({ id: ID, approve: z.boolean() }), raw);
    const l = await ctx.tx.leave.findFirst({ where: { id } });
    if (!l) return ctx.fail("That request no longer exists.");
    if (l.status !== "pending") ctx.fail("That request has already been decided.");
    if (l.memberId === ctx.me.id) ctx.fail("Someone else has to decide your own leave.");
    const m = await memberOf(ctx, l.memberId);
    const days = dayDiff(l.toDate.toISOString().slice(0, 10), l.fromDate.toISOString().slice(0, 10)) + 1;
    const updated = await ctx.tx.leave.update({
      where: { id },
      data: { status: approve ? "approved" : "declined", decidedById: ctx.me.id },
    });
    if (approve) {
      await ctx.tx.member.update({ where: { id: m.id }, data: { leaveUsed: { increment: days } } });
      await outMember(ctx, m.id);
    }
    ctx.upsert("leaves", [mapLeave(updated)]);
    await ctx.log({
      kind: "team",
      text: `${approve ? "approved" : "declined"} leave for ${m.name}`,
      target: "Team",
      area: "team",
      from: "Pending",
      to: approve ? "Approved" : "Declined",
    });
    return `Leave ${approve ? "approved" : "declined"}.`;
  });
}
