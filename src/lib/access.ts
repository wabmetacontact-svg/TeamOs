/**
 * Who can do what — the rules, written once.
 *
 * Access has two independent parts, exactly as the Access screen shows them:
 *
 *   sections   what part of the platform a person can use, per section:
 *              none (hidden from the sidebar), view (read only), edit
 *
 *   clients    which clients they reach, per client:
 *              view, edit (tasks and records), finance (includes money)
 *
 * An owner holds everything and cannot be narrowed by either.
 *
 * Plain functions over plain data, with no database and no "server-only": the
 * server enforces with them, and the browser uses the same ones to decide what
 * to show, so the two can never disagree about a rule.
 */

export const FEATURES = [
  ["dashboard", "Dashboard"],
  ["dashcards", "Dashboard figures"],
  ["tasks", "Tasks"],
  ["team", "Team"],
  ["payroll", "Payroll"],
  ["expenses", "Expenses"],
  ["ads", "Ads"],
  ["clients", "Clients"],
  ["access", "Access"],
  ["audit", "Audit trail"],
  ["import", "Import"],
] as const;

export type Feature = (typeof FEATURES)[number][0];
export type Level = "none" | "view" | "edit";
export type Features = Partial<Record<Feature, Level>>;

export const FEATURE_IDS = FEATURES.map((f) => f[0]) as Feature[];
export const featureName = (f: Feature) => FEATURES.find((x) => x[0] === f)?.[1] ?? f;

export const LEVEL_LABEL: Record<Level, string> = { none: "No access", view: "View", edit: "Edit" };
/** What a click on a cell in the Access matrix moves to. */
export const NEXT_LEVEL: Record<Level, Level> = { none: "view", view: "edit", edit: "none" };

export const PRESETS: Record<string, Record<Feature, Level>> = {
  Admin: {
    dashboard: "edit",
    dashcards: "view",
    tasks: "edit",
    team: "edit",
    payroll: "edit",
    expenses: "edit",
    ads: "edit",
    clients: "edit",
    access: "edit",
    audit: "view",
    import: "edit",
  },
  Manager: {
    dashboard: "view",
    dashcards: "view",
    tasks: "edit",
    team: "edit",
    payroll: "none",
    expenses: "view",
    ads: "view",
    clients: "edit",
    access: "none",
    audit: "view",
    import: "none",
  },
  Finance: {
    dashboard: "view",
    dashcards: "view",
    tasks: "view",
    team: "view",
    payroll: "edit",
    expenses: "edit",
    ads: "edit",
    clients: "edit",
    access: "none",
    audit: "view",
    import: "none",
  },
  Member: {
    dashboard: "view",
    dashcards: "none",
    tasks: "edit",
    team: "none",
    payroll: "none",
    expenses: "none",
    ads: "none",
    clients: "view",
    access: "none",
    audit: "none",
    import: "none",
  },
  "Read only": {
    dashboard: "view",
    dashcards: "none",
    tasks: "view",
    team: "view",
    payroll: "none",
    expenses: "view",
    ads: "view",
    clients: "view",
    access: "none",
    audit: "view",
    import: "none",
  },
};
export const PRESET_NAMES = Object.keys(PRESETS);

export type Grant = "view" | "edit" | "finance";
export type ClientLevel = "owner" | "none" | Grant;
export const CLIENT_LEVEL_LABEL: Record<ClientLevel, string> = {
  owner: "Owner",
  none: "No access",
  view: "View",
  edit: "Edit",
  finance: "Finance",
};
const RANK: Record<ClientLevel, number> = { none: 0, view: 1, edit: 2, finance: 3, owner: 4 };

/** The minimum a person needs to make access decisions about. */
export type Person = { id: string; isOwner: boolean; features: Features };

export function featureLevel(p: Person | undefined, f: Feature): Level {
  if (!p) return "none";
  if (p.isOwner) return "edit";
  return p.features[f] ?? "none";
}

export const canSee = (p: Person | undefined, f: Feature) => featureLevel(p, f) !== "none";
export const canEdit = (p: Person | undefined, f: Feature) => featureLevel(p, f) === "edit";

/** Grants keyed "memberId:clientId". */
export type GrantMap = ReadonlyMap<string, Grant>;
export const grantKey = (memberId: string, clientId: string) => `${memberId}:${clientId}`;

export function clientLevel(p: Person | undefined, clientId: string, grants: GrantMap): ClientLevel {
  if (!p) return "none";
  if (p.isOwner) return "owner";
  return grants.get(grantKey(p.id, clientId)) ?? "none";
}

export function reaches(p: Person | undefined, clientId: string, need: Grant, grants: GrantMap): boolean {
  return RANK[clientLevel(p, clientId, grants)] >= RANK[need];
}

/**
 * Money that belongs to no client — rent, software, salaries. Owners, and
 * whoever can edit Income and expenses.
 */
export const canOverhead = (p: Person | undefined) => !!p && (p.isOwner || canEdit(p, "expenses"));

/** A ledger entry: on a client it needs Finance there; otherwise overhead. */
export function canLedger(p: Person | undefined, e: { clientId: string | null; category?: string }, grants: GrantMap): boolean {
  if (!p) return false;
  if (e.clientId) return reaches(p, e.clientId, "finance", grants);
  if (!canOverhead(p)) return false;
  // A salary line says what one colleague earns; that is Payroll's business.
  if (e.category === "Salaries") return canSee(p, "payroll");
  return true;
}

/**
 * The people who run the team: decide leave, change employment status, limit
 * task boards, verify finished work. Owners, and whoever can edit Team.
 */
export const isTeamAdmin = (p: Person | undefined) => !!p && (p.isOwner || canEdit(p, "team"));

/** Editing a task: on a client it needs Edit there; otherwise Edit on Tasks. */
export function canEditTask(p: Person | undefined, t: { clientId: string | null }, grants: GrantMap): boolean {
  if (!p) return false;
  if (t.clientId) return reaches(p, t.clientId, "edit", grants) && canEdit(p, "tasks");
  return canEdit(p, "tasks");
}

/** Which modal needs which section at Edit. */
export const FORM_FEATURE: Record<string, Feature> = {
  entry: "expenses",
  editEntry: "expenses",
  confirmDelete: "expenses",
  task: "tasks",
  client: "clients",
  editClient: "clients",
  removeClient: "clients",
  member: "team",
  editMember: "team",
  leave: "team",
  draw: "payroll",
  deleteDraw: "payroll",
  salary: "payroll",
  password: "team",
  removeMember: "team",
};
