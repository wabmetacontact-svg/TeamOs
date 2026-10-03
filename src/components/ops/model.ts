import {
  canEditTask,
  canOverhead,
  clientLevel,
  featureLevel,
  isTeamAdmin,
  reaches,
  type ClientLevel,
  type Feature,
  type Grant,
  type Level,
  type Person,
} from "@/lib/access";
import { dayDiff, todayIn } from "@/lib/format";
import type { DisplayStatus } from "@/lib/labels";
import type { BrandW, ClientW, DeptW, MemberW, TaskW, Workspace } from "@/lib/types";

/**
 * Everything the screens derive from the workspace, computed once per change.
 *
 * The server already left out what this viewer may not see; these helpers
 * decide what to *offer* — which buttons, which fields — using the same
 * access functions the server enforces with.
 */

const UNKNOWN_MEMBER: MemberW = {
  id: "",
  name: "Unknown",
  email: null,
  title: "",
  isOwner: false,
  features: {},
  taskDeptIds: [],
  canLogin: false,
  dept: "",
  brandId: null,
  type: "",
  start: null,
  status: "",
  onPayroll: false,
  salary: null,
  leaveTotal: 0,
  leaveUsed: 0,
  phone: "",
  managerId: null,
  pay: null,
  salaryHistory: [],
};

export type Model = ReturnType<typeof buildModel>;

export function buildModel(w: Workspace) {
  const tz = w.tenant.timezone;
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);

  const memberById = new Map(w.members.map((m) => [m.id, m]));
  const clientById = new Map(w.clients.map((c) => [c.id, c]));
  const brandById = new Map(w.brands.map((b) => [b.id, b]));
  const deptById = new Map(w.depts.map((d) => [d.id, d]));
  const grants = new Map(w.grants.map((g) => [`${g.memberId}:${g.clientId}`, g.level as Grant]));

  const P = (id: string | null | undefined): MemberW => (id && memberById.get(id)) || UNKNOWN_MEMBER;
  const C = (id: string | null | undefined): ClientW | null => (id ? (clientById.get(id) ?? null) : null);
  const B = (id: string | null | undefined): BrandW | null => (id ? (brandById.get(id) ?? null) : null);
  const D = (id: string | null | undefined): DeptW | null => (id ? (deptById.get(id) ?? null) : null);
  const clientName = (id: string | null | undefined) => C(id)?.name ?? "No client";
  const brandName = (id: string | null | undefined) => B(id)?.name ?? "Overhead";

  const asPerson = (m: MemberW): Person => ({ id: m.id, isOwner: m.isOwner, features: m.features });
  const me = P(w.meId);
  const viewer = P(w.viewerId);
  const person = asPerson(viewer);
  const previewing = w.viewerId !== w.meId;
  const isOwner = viewer.isOwner;

  const fa = (f: Feature, who: MemberW = viewer): Level => featureLevel(asPerson(who), f);
  const sees = (f: Feature) => fa(f) !== "none";
  const edits = (f: Feature) => fa(f) === "edit";
  const lvl = (memberId: string, clientId: string): ClientLevel => clientLevel(asPerson(P(memberId)), clientId, grants);
  const can = (clientId: string, need: Grant) => reaches(person, clientId, need, grants);

  const team = w.members;
  const active = w.members.filter((m) => m.status !== "Exited");
  const owners = w.members.filter((m) => m.isOwner);

  const vis = w.clients.filter((c) => can(c.id, "view"));
  const fin = vis.filter((c) => can(c.id, "finance"));
  const visIds = new Set(vis.map((c) => c.id));
  const finIds = new Set(fin.map((c) => c.id));

  const teamAdmin = isTeamAdmin(person);
  const overhead = canOverhead(person);
  const payV = sees("payroll");
  const payE = edits("payroll");

  const doneAt = (t: TaskW): string | null => {
    if (t.status !== "done") return null;
    const x = [...t.hist].reverse().find((h) => h.status === "done");
    return x ? x.at.slice(0, 10) : t.due;
  };
  const lateDays = (t: TaskW): number => {
    if (!t.due) return 0;
    if (t.status === "done") {
      const d = doneAt(t);
      return d && d > t.due ? dayDiff(d, t.due) : 0;
    }
    return t.due < today ? dayDiff(today, t.due) : 0;
  };
  /** Its status, or "late" when it is not started or in progress and overdue. */
  const stOf = (t: TaskW): DisplayStatus =>
    (t.status === "todo" || t.status === "doing") && t.due && t.due < today ? "late" : t.status;
  const tagOf = (t: { brandId: string; clientId: string | null; area: string }) =>
    `${brandName(t.brandId)} · ${t.clientId ? clientName(t.clientId) : t.area || "Operations"}`;
  const tgtOf = (t: { brandId: string; clientId: string | null }) => (t.clientId ? clientName(t.clientId) : brandName(t.brandId));
  const canTask = (t: { clientId: string | null }) => canEditTask(person, t, grants);

  /** Task departments this viewer is limited to, or null for all. */
  const myDepts = !isOwner && viewer.taskDeptIds.length ? new Set(viewer.taskDeptIds) : null;
  const deptsForMe = w.depts.filter((d) => !myDepts || myDepts.has(d.id));

  /** A client's cost this month: its expenses plus logged hours at the workspace rate. */
  const stats = (c: ClientW, month = thisMonth) => {
    const exp = w.ledger
      .filter((e) => e.type === "out" && e.clientId === c.id && e.date.startsWith(month))
      .reduce((a, e) => a + e.amount, 0);
    const hrs = w.tasks.filter((t) => t.clientId === c.id).reduce((a, t) => a + (t.hours || 0), 0);
    const cost = exp + hrs * w.tenant.hourlyRate;
    return { exp, hrs, cost, margin: (c.retainer ?? 0) - cost };
  };

  const holidays = new Map(w.holidays.map((h) => [h.date, h.name]));

  return {
    tz,
    today,
    thisMonth,
    me,
    viewer,
    person,
    previewing,
    isOwner,
    P,
    C,
    B,
    D,
    clientName,
    brandName,
    fa,
    sees,
    edits,
    lvl,
    can,
    grants,
    team,
    active,
    owners,
    vis,
    fin,
    visIds,
    finIds,
    teamAdmin,
    overhead,
    payV,
    payE,
    doneAt,
    lateDays,
    stOf,
    tagOf,
    tgtOf,
    canTask,
    myDepts,
    deptsForMe,
    stats,
    holidays,
  };
}
