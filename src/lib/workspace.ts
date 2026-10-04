import "server-only";
import type {
  AdSpend,
  AuditEntry,
  Brand,
  Client,
  CommissionRate,
  CommissionRule,
  ClientGrant,
  ClientRate,
  Holiday,
  LedgerEntry,
  Leave,
  Member,
  SalaryChange,
  SheetColumn,
  Task,
  TaskDepartment,
  TaskNote,
  TaskSeries,
  TaskStatusChange,
  Tenant,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { tenantDb, tenantTransaction } from "./db";
import {
  canLedger,
  canOverhead,
  canSee,
  grantKey,
  reaches,
  type Features,
  type Grant,
  type GrantMap,
  type Person,
} from "./access";
import { nowIn, todayIn } from "./format";
import { occurrencesThrough, type Rule } from "./recurrence";
import type {
  AdSpendW,
  AuditW,
  BrandW,
  ClientW,
  CommissionRateW,
  CommissionRuleW,
  DeptW,
  EntryW,
  GrantW,
  HolidayW,
  LeaveW,
  MemberW,
  Priority,
  SeriesW,
  SheetColW,
  TaskStatus,
  TaskW,
  TenantW,
  Workspace,
} from "./types";
import type { Signed } from "./auth";

/**
 * Builds the workspace for one viewer.
 *
 * This is where reading is secured. Whatever a person may not see is left out
 * here, on the server, rather than hidden by the screen: the browser only ever
 * receives the clients they have a grant on, money only where they hold
 * Finance, salaries only with Payroll, and so on. The screens then compute
 * freely from what they were given.
 */

// ─────────────────────────────────────────────────────────── conversions ───

export const rupees = (paise: bigint | null | undefined) => (paise == null ? 0 : Number(paise) / 100);
export const rupeesOrNull = (paise: bigint | null | undefined) => (paise == null ? null : Number(paise) / 100);
/** Rupees (as typed) to paise, rounding to the nearest paisa. */
export const toPaise = (rupeeAmount: number) => BigInt(Math.round(rupeeAmount * 100));

export const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/** A yyyy-MM-dd string as the Date Prisma writes to a DATE column. */
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const decimal = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

export type Viewer = Person & { taskDeptIds: string[] };

export function asPerson(m: Member): Viewer {
  return { id: m.id, isOwner: m.isOwner, features: (m.features ?? {}) as Features, taskDeptIds: m.taskDeptIds };
}

export function grantMap(grants: Pick<ClientGrant, "memberId" | "clientId" | "level">[]): Map<string, Grant> {
  return new Map(grants.map((g) => [grantKey(g.memberId, g.clientId), g.level as Grant]));
}

// ─────────────────────────────────────────────────────────────── mappers ───

export type MapCtx = { tz: string; payroll: boolean; finance: (clientId: string) => boolean };

export function mapTenant(t: Tenant): TenantW {
  return {
    id: t.id,
    name: t.name,
    timezone: t.timezone,
    hourlyRate: rupees(t.hourlyRate),
    incomeCategories: t.incomeCategories,
    expenseCategories: t.expenseCategories,
    hrDepartments: t.hrDepartments,
    commissionSkip: t.commissionSkip,
  };
}

export const mapCommissionRate = (r: CommissionRate): CommissionRateW => ({
  id: r.id,
  memberId: r.memberId,
  from: dateOnly(r.effectiveFrom)!,
  bps: r.bps,
});

export const mapAdSpend = (a: AdSpend): AdSpendW => ({
  id: a.id,
  memberId: a.memberId,
  month: dateOnly(a.month)!.slice(0, 7),
  amount: rupees(a.amount),
  leads: a.leads,
  note: a.note,
  ledgerEntryId: a.ledgerEntryId,
  byId: a.createdById,
});

export const mapCommissionRule = (r: CommissionRule): CommissionRuleW => ({
  id: r.id,
  memberId: r.memberId,
  clientId: r.clientId,
  kind: r.kind === "percent" ? "percent" : "fixed",
  amount: rupees(r.amount),
  bps: r.bps,
  repeat: r.repeat === "monthly" ? "monthly" : "once",
  fromMonth: dateOnly(r.fromMonth)!.slice(0, 7),
  toMonth: r.toMonth ? dateOnly(r.toMonth)!.slice(0, 7) : null,
  note: r.note,
  byId: r.createdById,
});

export function mapMember(m: Member, ctx: MapCtx, salaries: SalaryChange[] = []): MemberW {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    title: m.title,
    isOwner: m.isOwner,
    features: (m.features ?? {}) as Features,
    taskDeptIds: m.taskDeptIds,
    canLogin: !!m.passwordHash,
    dept: m.department ?? "",
    brandId: m.brandId,
    type: m.employmentType,
    start: dateOnly(m.startDate),
    status: m.hrStatus,
    onPayroll: m.salary != null && m.salary > 0n,
    salary: ctx.payroll ? rupeesOrNull(m.salary) : null,
    leaveTotal: m.leaveTotal,
    leaveUsed: m.leaveUsed,
    phone: m.phone ?? "",
    managerId: m.managerId,
    pay:
      ctx.payroll && m.payMethod
        ? {
            method: m.payMethod === "upi" ? "upi" : "bank",
            upi: m.payUpi ?? "",
            holder: m.payHolder ?? "",
            bank: m.payBank ?? "",
            account: m.payAccount ?? "",
            ifsc: m.payIfsc ?? "",
          }
        : null,
    salaryHistory: ctx.payroll
      ? salaries
          .filter((s) => s.memberId === m.id)
          .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
          .map((s) => ({ from: dateOnly(s.effectiveFrom)!, amount: rupees(s.amount) }))
      : [],
  };
}

export const mapBrand = (b: Brand): BrandW => ({
  id: b.id,
  name: b.name,
  kind: b.kind === "startup" ? "startup" : "agency",
  areas: b.areas,
});

export function mapClient(c: Client, ctx: MapCtx, rates: ClientRate[] = []): ClientW {
  const fin = ctx.finance(c.id);
  return {
    id: c.id,
    brandId: c.brandId,
    name: c.name,
    company: c.company,
    retainer: fin ? rupees(c.retainer) : null,
    currency: c.currency,
    services: c.services,
    contact: c.contact,
    sinceDate: dateOnly(c.sinceDate),
    payDay: c.payDay,
    ownerId: c.ownerMemberId,
    onboarderId: c.onboarderMemberId,
    synced: c.externalSource !== null,
    wabmetaId: c.externalSource === "wabmeta" && c.externalId?.startsWith("org:") ? c.externalId.slice(4) : null,
    loginId: c.loginId,
    phone: c.phone,
    plan: c.plan,
    details: c.details,
    // Only that it exists. passwordEnc is deliberately not mapped: this object
    // is sent to the browser on every page load.
    hasPassword: c.passwordEnc !== null,
    setup: (c.setup as ClientW["setup"]) ?? null,
    rates: fin
      ? rates
          .filter((r) => r.clientId === c.id)
          .sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime())
          .map((r) => ({ from: dateOnly(r.fromDate)!, to: dateOnly(r.toDate), amount: rupees(r.amount), currency: r.currency }))
      : [],
  };
}

export const mapGrant = (g: Pick<ClientGrant, "memberId" | "clientId" | "level">): GrantW => ({
  id: grantKey(g.memberId, g.clientId),
  memberId: g.memberId,
  clientId: g.clientId,
  level: g.level as Grant,
});

export function mapEntry(e: LedgerEntry): EntryW {
  return {
    id: e.id,
    type: e.type === "in" ? "in" : "out",
    date: dateOnly(e.date)!,
    desc: e.description,
    clientId: e.clientId,
    category: e.category,
    amount: rupees(e.amount),
    status: e.status === "pending" ? "pending" : "paid",
    paidOn: dateOnly(e.paidOn),
    currency: e.currency,
    orig: rupeesOrNull(e.origAmount),
    method: e.method,
    memberId: e.memberId,
    partnerId: e.partnerId,
    sourceId: e.sourceId,
    note: e.note ?? "",
    byId: e.createdById,
  };
}

export const mapDept = (d: TaskDepartment): DeptW => ({ id: d.id, name: d.name, color: d.color });

export type TaskRow = Task & { changes: TaskStatusChange[]; notes: TaskNote[] };
export const TASK_INCLUDE = {
  changes: { orderBy: { at: "asc" } },
  notes: { orderBy: { at: "asc" } },
} satisfies Prisma.TaskInclude;

export function mapTask(t: TaskRow, tz: string): TaskW {
  return {
    id: t.id,
    title: t.title,
    brandId: t.brandId,
    clientId: t.clientId,
    area: t.area,
    whoId: t.assigneeId,
    byId: t.assignedById,
    status: t.status as TaskStatus,
    deptId: t.departmentId,
    hours: decimal(t.hours) ?? 0,
    due: dateOnly(t.due),
    dueTime: t.dueTime,
    pri: t.priority as Priority,
    est: decimal(t.estimate),
    created: dateOnly(t.createdOn)!,
    verified: t.verified,
    seriesId: t.seriesId,
    custom: (t.custom ?? {}) as Record<string, string>,
    hist: t.changes.map((h) => ({ status: h.status as TaskStatus, at: nowIn(tz, h.at), byId: h.byId })),
    notes: t.notes.map((n) => ({ id: n.id, byId: n.byId, at: nowIn(tz, n.at), text: n.text, link: n.link ?? "" })),
  };
}

export function seriesRule(s: TaskSeries): Rule {
  return {
    freq: s.freq as Rule["freq"],
    weekday: s.weekday,
    everyDays: s.everyDays,
    time: s.time,
    start: dateOnly(s.startDate)!,
    until: dateOnly(s.untilDate),
  };
}

export function mapSeries(s: TaskSeries): SeriesW {
  return {
    id: s.id,
    title: s.title,
    brandId: s.brandId,
    clientId: s.clientId,
    area: s.area,
    whoId: s.assigneeId,
    byId: s.createdById,
    deptId: s.departmentId,
    pri: s.priority as Priority,
    est: decimal(s.estimate),
    active: s.active,
    rule: seriesRule(s),
  };
}

export const mapSheetCol = (c: SheetColumn): SheetColW => ({ id: c.id, name: c.name });

export const mapLeave = (l: Leave): LeaveW => ({
  id: l.id,
  memberId: l.memberId,
  type: l.type,
  from: dateOnly(l.fromDate)!,
  to: dateOnly(l.toDate)!,
  note: l.note,
  status: l.status as LeaveW["status"],
});

export const mapHoliday = (h: Holiday): HolidayW => ({ id: h.id, date: dateOnly(h.date)!, name: h.name });

export const mapAudit = (a: AuditEntry, tz: string): AuditW => ({
  id: a.id,
  at: nowIn(tz, a.at),
  who: a.actorName,
  kind: a.kind as AuditW["kind"],
  text: a.text,
  target: a.target,
  clientId: a.clientId,
  from: a.fromValue,
  to: a.toValue,
});

// ──────────────────────────────────────────────────────── recurring tasks ───

/** The deterministic id of one occurrence, which makes creating it idempotent. */
export const occurrenceId = (seriesId: string, date: string) => `rs_${seriesId}_${date}`;

/**
 * Creates every occurrence of every active series that has come due and does
 * not exist yet. Safe to run on every load: ids are deterministic and inserts
 * skip what is already there, so two requests at once create each day once.
 */
export async function rollSeries(tenantId: string, today: string): Promise<number> {
  const db = tenantDb(tenantId);
  const series = await db.taskSeries.findMany({ where: { active: true } });
  if (!series.length) return 0;

  const existing = await db.task.findMany({
    where: { seriesId: { in: series.map((s) => s.id) } },
    select: { seriesId: true, due: true },
  });
  const have = new Set(existing.map((t) => `${t.seriesId}:${dateOnly(t.due)}`));

  const departments = await db.taskDepartment.findMany({ orderBy: { position: "asc" }, take: 1 });
  const fallbackDept = departments[0]?.id;
  if (!fallbackDept) return 0;

  const tasks: Prisma.TaskCreateManyInput[] = [];
  const changes: Prisma.TaskStatusChangeCreateManyInput[] = [];
  for (const s of series) {
    const rule = seriesRule(s);
    for (const d of occurrencesThrough(rule, today)) {
      if (have.has(`${s.id}:${d}`)) continue;
      const id = occurrenceId(s.id, d);
      tasks.push({
        id,
        tenantId,
        title: s.title,
        brandId: s.brandId,
        clientId: s.clientId,
        area: s.area,
        assigneeId: s.assigneeId,
        assignedById: s.createdById,
        departmentId: s.departmentId ?? fallbackDept,
        status: "todo",
        due: toDate(d),
        dueTime: s.time,
        priority: s.priority,
        estimate: s.estimate,
        createdOn: toDate(d),
        seriesId: s.id,
      });
      const at = `${d}T${s.time && s.time < "08:00" ? s.time : "08:00"}:00.000Z`;
      changes.push({ id: `h_${id}`, tenantId, taskId: id, status: "todo", at: new Date(at), byId: s.createdById });
    }
  }
  if (!tasks.length) return 0;

  await tenantTransaction(tenantId, async (tx) => {
    await tx.task.createMany({ data: tasks, skipDuplicates: true });
    await tx.taskStatusChange.createMany({ data: changes, skipDuplicates: true });
  });
  return tasks.length;
}

// ─────────────────────────────────────────────────────────── the loader ───

/** What a viewer reaches, computed once and shared by every filter below. */
export type Reach = {
  viewer: Viewer;
  grants: GrantMap;
  visibleClient: (id: string) => boolean;
  financeClient: (id: string) => boolean;
  payroll: boolean;
};

export function reachOf(viewer: Viewer, grants: GrantMap): Reach {
  return {
    viewer,
    grants,
    visibleClient: (id) => reaches(viewer, id, "view", grants),
    financeClient: (id) => reaches(viewer, id, "finance", grants),
    payroll: canSee(viewer, "payroll"),
  };
}

/** Whether a task is on this viewer's board at all. */
export function taskVisible(r: Reach, t: { clientId: string | null; departmentId: string; assigneeId: string }): boolean {
  if (t.clientId && !r.visibleClient(t.clientId)) return false;
  const limit = !r.viewer.isOwner && r.viewer.taskDeptIds.length ? new Set(r.viewer.taskDeptIds) : null;
  return !limit || limit.has(t.departmentId) || t.assigneeId === r.viewer.id;
}

/** Whether an audit entry is this viewer's to read. */
export function auditVisible(r: Reach, a: Pick<AuditEntry, "clientId" | "area">): boolean {
  if (r.viewer.isOwner) return true;
  if (a.clientId) return r.visibleClient(a.clientId);
  if (a.area === "team") return true;
  if (a.area === "payroll") return r.payroll;
  if (a.area === "ledger") return canOverhead(r.viewer);
  if (a.area === "tasks") return canSee(r.viewer, "tasks");
  return false;
}

/** How much history the screens are sent; older entries stay in the database. */
const AUDIT_LIMIT = 1000;

export async function loadWorkspace(signed: Signed): Promise<Workspace> {
  const { tenant, me } = signed;
  const tz = tenant.timezone;
  const db = tenantDb(tenant.id);

  await rollSeries(tenant.id, todayIn(tz));

  // Read the viewer again rather than trusting the session's copy: a grant or
  // a section changed a moment ago must apply to this very load.
  const [viewerRow, grantRows] = await Promise.all([
    db.member.findFirstOrThrow({ where: { id: signed.viewer.id } }),
    db.clientGrant.findMany(),
  ]);
  const viewer = asPerson(viewerRow);
  const r = reachOf(viewer, grantMap(grantRows));

  const [members, salaries, brands, clients, rates, ledger, depts, tasks, series, cols, leaves, holidays, audit, commissionRates, commissionRules, adSpends] =
    await Promise.all([
      db.member.findMany({ orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] }),
      r.payroll ? db.salaryChange.findMany() : Promise.resolve([]),
      db.brand.findMany({ orderBy: { createdAt: "asc" } }),
      db.client.findMany({ where: { removedAt: null }, orderBy: { name: "asc" } }),
      db.clientRate.findMany(),
      db.ledgerEntry.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
      db.taskDepartment.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      db.task.findMany({ include: TASK_INCLUDE, orderBy: { createdAt: "asc" } }),
      db.taskSeries.findMany({ orderBy: { createdAt: "asc" } }),
      db.sheetColumn.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      db.leave.findMany({ orderBy: { fromDate: "desc" } }),
      db.holiday.findMany({ orderBy: { date: "asc" } }),
      db.auditEntry.findMany({ orderBy: { at: "desc" }, take: AUDIT_LIMIT * 2 }),
      // What somebody is paid is Payroll's business, like their salary.
      r.payroll ? db.commissionRate.findMany({ orderBy: { effectiveFrom: "asc" } }) : Promise.resolve([]),
      r.payroll ? db.commissionRule.findMany({ orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
      // Ad spend is overhead money - no client - so it follows the overhead rule.
      canOverhead(viewer) ? db.adSpend.findMany({ orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    ]);

  const ctx: MapCtx = { tz, payroll: r.payroll, finance: r.financeClient };
  const visibleClients = clients.filter((c) => r.visibleClient(c.id));
  const visibleIds = new Set(visibleClients.map((c) => c.id));

  return {
    tenant: mapTenant(tenant),
    meId: me.id,
    viewerId: viewer.id,
    members: members.map((m) => mapMember(m, ctx, salaries)),
    brands: brands.map(mapBrand),
    clients: visibleClients.map((c) => mapClient(c, ctx, rates)),
    grants: grantRows.filter((g) => visibleIds.has(g.clientId)).map(mapGrant),
    ledger: ledger.filter((e) => canLedger(viewer, e, r.grants)).map(mapEntry),
    depts: depts.map(mapDept),
    tasks: tasks.filter((t) => taskVisible(r, t)).map((t) => mapTask(t, tz)),
    series: series.filter((s) => !s.clientId || r.visibleClient(s.clientId)).map(mapSeries),
    sheetCols: cols.map(mapSheetCol),
    leaves: leaves.map(mapLeave),
    holidays: holidays.map(mapHoliday),
    audit: audit
      .filter((a) => auditVisible(r, a))
      .slice(0, AUDIT_LIMIT)
      .map((a) => mapAudit(a, tz)),
    commissionRates: commissionRates.map(mapCommissionRate),
    commissionRules: commissionRules.map(mapCommissionRule),
    adSpends: adSpends.map(mapAdSpend),
  };
}
