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
