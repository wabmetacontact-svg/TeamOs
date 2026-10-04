import type { Feature, Grant, Level } from "./access";
import type { Freq } from "./recurrence";

/**
 * The workspace as the browser holds it.
 *
 * The server builds this for one viewer and leaves out whatever they may not
 * see — a client they have no grant on, money without Finance, salaries
 * without Payroll — so the screens can compute freely from it without being
 * the thing that keeps a secret. Money is in rupees, dates are yyyy-MM-dd,
 * timestamps are yyyy-MM-ddTHH:mm in the workspace's time zone.
 */

export type TenantW = {
  id: string;
  name: string;
  timezone: string;
  /** Rupees per logged hour. */
  hourlyRate: number;
  incomeCategories: string[];
  expenseCategories: string[];
  hrDepartments: string[];
};

export type PayW = {
  method: "bank" | "upi";
  upi: string;
  holder: string;
  bank: string;
  account: string;
  ifsc: string;
};

export type MemberW = {
  id: string;
  name: string;
  email: string | null;
  title: string;
  isOwner: boolean;
  features: Partial<Record<Feature, Level>>;
  taskDeptIds: string[];
  /** Has a password, so can sign in. */
  canLogin: boolean;
  dept: string;
  brandId: string | null;
  type: string;
  start: string | null;
  status: string;
  /** On payroll at all. Shown even to people who cannot see the amount. */
  onPayroll: boolean;
  /** Null when the viewer cannot see payroll. */
  salary: number | null;
  leaveTotal: number;
  leaveUsed: number;
  phone: string;
  managerId: string | null;
  /** Payroll viewers only. */
  pay: PayW | null;
  salaryHistory: { from: string; amount: number }[];
};

export type BrandW = { id: string; name: string; kind: "agency" | "startup"; areas: string[] };

export type ClientW = {
  id: string;
  brandId: string;
  name: string;
  company: string;
  /** Null without Finance on this client. */
  retainer: number | null;
  currency: string;
  services: string;
  contact: string;
  sinceDate: string | null;
  payDay: number | null;
  rates: { from: string; to: string | null; amount: number; currency: string }[];
  /**
   * The team member who brought this client in. Credit, not access - who may
   * open a client is still decided by grants. Set by the WabMeta sync for the
   * clients it mirrors, and null for clients added here.
   */
  ownerId: string | null;
  /** Who is onboarding it, when somebody is. */
  onboarderId: string | null;
  /**
   * Mirrored from WabMeta. Its name, contact, monthly figure and start date
   * belong to WabMeta and are overwritten by the next sync, so they are not
   * edited here.
   */
  synced: boolean;
  /** The organization's id in WabMeta, for synced clients. */
  wabmetaId: string | null;
  loginId: string;
  phone: string;
  plan: string;
  details: string;
  /** Whether a password is stored. The password itself is never in the workspace. */
  hasPassword: boolean;
};

/** id is "memberId:clientId". */
export type GrantW = { id: string; memberId: string; clientId: string; level: Grant };

export type EntryW = {
  id: string;
  type: "in" | "out";
  date: string;
  desc: string;
  clientId: string | null;
  category: string;
  amount: number;
  status: "paid" | "pending";
  paidOn: string | null;
  currency: string | null;
  orig: number | null;
  method: string | null;
  memberId: string | null;
  partnerId: string | null;
  sourceId: string | null;
  note: string;
  byId: string;
};

export type DeptW = { id: string; name: string; color: string };

export type TaskStatus = "todo" | "doing" | "review" | "blocked" | "done";
export type Priority = "high" | "medium" | "low";

export type TaskW = {
  id: string;
  title: string;
  brandId: string;
  clientId: string | null;
  area: string;
  whoId: string;
  byId: string;
  status: TaskStatus;
  deptId: string;
  hours: number;
  due: string | null;
  dueTime: string | null;
  pri: Priority;
  est: number | null;
  created: string;
  verified: boolean;
  seriesId: string | null;
  custom: Record<string, string>;
  hist: { status: TaskStatus; at: string; byId: string }[];
  notes: { id: string; byId: string; at: string; text: string; link: string }[];
};

export type SeriesW = {
  id: string;
  title: string;
  brandId: string;
  clientId: string | null;
  area: string;
  whoId: string;
  byId: string;
  deptId: string | null;
  pri: Priority;
  est: number | null;
  active: boolean;
  rule: { freq: Freq; weekday: number | null; everyDays: number; time: string | null; start: string; until: string | null };
};

export type SheetColW = { id: string; name: string };

export type LeaveW = {
  id: string;
  memberId: string;
  type: string;
  from: string;
  to: string;
  note: string;
  status: "pending" | "approved" | "declined";
};

export type HolidayW = { id: string; date: string; name: string };

export type AuditKind = "expense" | "task" | "access" | "team" | "client";

export type AuditW = {
  id: string;
  at: string;
  who: string;
  kind: AuditKind;
  text: string;
  target: string;
  clientId: string | null;
  from: string;
  to: string;
};

export type Workspace = {
  tenant: TenantW;
  /** The signed-in person. */
  meId: string;
  /** Whose eyes the data was built for: meId, or someone an owner previews as. */
  viewerId: string;
  members: MemberW[];
  brands: BrandW[];
  clients: ClientW[];
  grants: GrantW[];
  ledger: EntryW[];
  depts: DeptW[];
  tasks: TaskW[];
  series: SeriesW[];
  sheetCols: SheetColW[];
  leaves: LeaveW[];
  holidays: HolidayW[];
  audit: AuditW[];
};

/** The collections a change can touch, by name. */
export type Collections = Pick<
  Workspace,
  "members" | "brands" | "clients" | "grants" | "ledger" | "depts" | "tasks" | "series" | "sheetCols" | "leaves" | "holidays" | "audit"
>;

/** What an action sends back: the records it changed, applied in place. */
export type Patch = {
  upsert?: { [K in keyof Collections]?: Collections[K] };
  remove?: { [K in keyof Collections]?: string[] };
  tenant?: Partial<TenantW>;
};

export type Result<T = undefined> =
  | { ok: true; patch?: Patch; message?: string; data?: T }
  | { ok: false; error: string; fields?: Record<string, string> };
