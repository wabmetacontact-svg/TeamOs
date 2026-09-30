/**
 * The permission catalogue.
 *
 * A permission is `resource:action`. Roles hold sets of them; users hold one
 * role plus a scope. Roles are data — an admin can create or edit them — but
 * this catalogue is the fixed list of things that can be permitted.
 *
 * The PRD's v1 table covers user, role, client, expense, dashboard, audit and
 * settings. Tasks, relationships and people ship in the same release, so their
 * permissions are added here; without them those modules would have nothing to
 * check against.
 */

export const PERMISSION_CATALOGUE = {
  user: ["view", "invite", "edit", "deactivate", "assign_role"],
  role: ["view", "create", "edit", "delete"],
  client: ["view", "create", "edit", "archive", "delete"],
  person: ["view", "create", "edit", "delete"],
  relationship: ["view", "create", "edit", "delete"],
  task: ["view", "create", "edit", "delete", "verify"],
  expense: ["view", "create", "edit", "delete", "approve", "export"],
  book_month: ["close", "reopen"],
  dashboard: ["view_own", "view_scoped", "view_all"],
  audit: ["view"],
  settings: ["view", "edit"],
} as const;

export type Resource = keyof typeof PERMISSION_CATALOGUE;
export type PermissionKey = {
  [R in Resource]: `${R}:${(typeof PERMISSION_CATALOGUE)[R][number]}`;
}[Resource];

export const ALL_PERMISSIONS: PermissionKey[] = Object.entries(PERMISSION_CATALOGUE).flatMap(([resource, actions]) =>
  (actions as readonly string[]).map((action) => `${resource}:${action}` as PermissionKey),
);

export function permissionLabel(key: string): string {
  const [resource, action] = key.split(":");
  return `${action?.replace(/_/g, " ")} ${resource?.replace(/_/g, " ")}`.replace(/\b\w/, (c) => c.toUpperCase());
}

/**
 * The catalogue as the screens name things, for showing what a role grants.
 *
 * `user:invite, expense:approve` means nothing to the person choosing a role
 * for a new hire. "Team: invite · Ledger: approve" does. Relationships are
 * left out because the Pipelines screens were removed; the permission still
 * exists so the data behind it stays governed.
 */
export const MODULES: { resource: Resource; label: string; actions: Partial<Record<string, string>> }[] = [
  { resource: "client", label: "Clients", actions: { view: "see", create: "add", edit: "edit", archive: "archive", delete: "delete" } },
  { resource: "expense", label: "Ledger", actions: { view: "see", create: "add", edit: "edit", delete: "delete", approve: "approve", export: "export" } },
  { resource: "book_month", label: "Month close", actions: { close: "close", reopen: "reopen" } },
  { resource: "task", label: "Tasks", actions: { view: "see", create: "assign", edit: "edit", delete: "delete", verify: "verify" } },
  { resource: "person", label: "Directory", actions: { view: "see", create: "add", edit: "edit", delete: "delete" } },
  { resource: "dashboard", label: "Dashboard", actions: { view_own: "own work", view_scoped: "their clients", view_all: "everything" } },
  { resource: "user", label: "Team", actions: { view: "see", invite: "invite", edit: "change access", deactivate: "deactivate", assign_role: "change roles" } },
  { resource: "role", label: "Roles", actions: { view: "see", create: "create", edit: "edit", delete: "delete" } },
  { resource: "settings", label: "Brands & settings", actions: { view: "see", edit: "edit" } },
  { resource: "audit", label: "Audit log", actions: { view: "see" } },
];

/** What a set of permission keys amounts to, module by module. */
export function summarizePermissions(keys: Iterable<string>) {
  const held = new Set(keys);
  return MODULES.map((module) => {
    const granted = Object.entries(module.actions)
      .filter(([action]) => held.has(`${module.resource}:${action}`))
      .map(([, label]) => label!);
    return { resource: module.resource, label: module.label, granted };
  });
}

// ────────────────────────────────────────────── per-person feature access ───

/** Every key the per-person picker can change. Relationship keys are not offered. */
export const PICKABLE_PERMISSIONS: ReadonlySet<string> = new Set(
  MODULES.flatMap((m) => Object.keys(m.actions).map((action) => `${m.resource}:${action}`)),
);

/**
 * What one person can actually do: their role, plus what was granted to them,
 * minus what was taken away. An Owner is always exactly their role — the
 * workspace must keep someone nobody can narrow.
 */
export function effectivePermissions(
  roleName: string,
  roleKeys: Iterable<string>,
  granted: readonly string[] = [],
  revoked: readonly string[] = [],
): Set<string> {
  const keys = new Set(roleKeys);
  if (roleName === PROTECTED_ROLE) return keys;
  for (const key of granted) keys.add(key);
  for (const key of revoked) keys.delete(key);
  return keys;
}

/**
 * A `user` where-clause for "everyone who can do this", the same arithmetic as
 * effectivePermissions done in the database: held through the role or granted
 * personally, and not taken away — unless they are an Owner, whom nothing
 * narrows.
 */
export function holdersOf(key: PermissionKey) {
  return {
    AND: [
      {
        OR: [
          { role: { permissions: { some: { permission: { key } } } } },
          { permissionsGranted: { has: key } },
        ],
      },
      { OR: [{ NOT: { permissionsRevoked: { has: key } } }, { role: { name: PROTECTED_ROLE } }] },
    ],
  };
}

/**
 * Turns the set somebody ticked into what is stored: the difference from the
 * role. Keys the picker does not offer keep whatever the role says.
 *
 * `escalations` is every key granted beyond the role that the person granting
 * does not hold themselves. It must be empty for the change to be allowed —
 * otherwise anyone who can invite could mint an account more powerful than
 * their own and sign in as it.
 */
export function permissionOverrides(input: {
  roleName: string;
  roleKeys: Iterable<string>;
  chosen: Iterable<string>;
  granterKeys: ReadonlySet<string>;
}): { granted: string[]; revoked: string[]; escalations: string[]; unknown: string[] } {
  const role = new Set(input.roleKeys);
  const chosen = new Set(input.chosen);
  // Keys that exist but are not offered are ignored; keys that do not exist
  // at all are reported, because the form that sent them is out of date.
  const known = new Set<string>(ALL_PERMISSIONS);
  const unknown = [...chosen].filter((key) => !known.has(key));

  if (input.roleName === PROTECTED_ROLE) return { granted: [], revoked: [], escalations: [], unknown };

  const granted = [...chosen].filter((key) => PICKABLE_PERMISSIONS.has(key) && !role.has(key)).sort();
  const revoked = [...role].filter((key) => PICKABLE_PERMISSIONS.has(key) && !chosen.has(key)).sort();
  const escalations = granted.filter((key) => !input.granterKeys.has(key));

  return { granted, revoked, escalations, unknown };
}

/**
 * The five roles that ship as defaults. Seed data, not hardcoded logic: an
 * admin can edit any of them or add their own. What cannot change is the
 * catalogue above and the rules in §"Rules that hold regardless" of the PRD.
 */
export const DEFAULT_ROLES: {
  name: string;
  description: string;
  allClients: boolean;
  permissions: PermissionKey[] | "all";
}[] = [
  {
    name: "Owner",
    description: "Everything, including roles and deleting data. The last Owner cannot be removed or demoted.",
    allClients: true,
    permissions: "all",
  },
  {
    name: "Admin",
    description: "Manages users, clients, expenses and settings. Cannot change the Owner's role.",
    allClients: true,
    permissions: "all",
  },
  {
    name: "Finance",
    description: "All clients and financial data: entry, approval, export, close. No user management.",
    allClients: true,
    permissions: [
      "client:view",
      "person:view",
      "relationship:view",
      "task:view",
      "expense:view",
      "expense:create",
      "expense:edit",
      "expense:delete",
      "expense:approve",
      "expense:export",
      "book_month:close",
      "book_month:reopen",
      "dashboard:view_all",
      "audit:view",
      "settings:view",
      "user:view",
    ],
  },
  {
    name: "Manager",
    description: "Their assigned clients only: manages them, submits and approves expenses within scope.",
    allClients: false,
    permissions: [
      "client:view",
      "client:create",
      "client:edit",
      "person:view",
      "person:create",
      "person:edit",
      "relationship:view",
      "relationship:create",
      "relationship:edit",
      "task:view",
      "task:create",
      "task:edit",
      "task:verify",
      "expense:view",
      "expense:create",
      "expense:edit",
      "expense:approve",
      "expense:export",
      "dashboard:view_scoped",
      "user:view",
    ],
  },
  {
    name: "Member",
    description: "Submits expenses and works their tasks on assigned clients. No organisation-wide totals.",
    allClients: false,
    permissions: ["client:view", "person:view", "task:view", "task:edit", "expense:view", "expense:create", "dashboard:view_own"],
  },
];

/** Roles that must always keep every permission, whatever an admin edits. */
export const PROTECTED_ROLE = "Owner";
