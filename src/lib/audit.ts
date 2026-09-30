import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { NotFoundError, type Scope } from "./scope";

/**
 * Reading the audit log.
 *
 * The log is append-only at the database and nothing in the application can
 * edit it, which is what makes it worth reading. This module is the only way
 * it is read, and it is scoped like everything else — an audit trail that
 * shows a Manager what happened on a client they cannot see would be a way to
 * learn about that client.
 *
 * Scoping an audit log is genuinely awkward, because an entry is about a
 * resource rather than owning a client id. The honest answer is the one below:
 * entries about a client-owned resource are filtered by resolving that
 * resource, and entries about the workspace itself are shown only to people
 * who can already see the whole workspace.
 */

export const AUDIT_ACTIONS = [
  "created", "updated", "updated_after_approval", "deleted", "restored", "archived",
  "submitted", "approved", "rejected", "completed", "verified", "imported",
  "closed", "reopened", "stage_changed", "status_changed", "reassigned", "merged",
  "invited", "invitation_accepted", "invitation_revoked", "role_changed", "access_changed",
  "permissions_changed", "access_granted", "access_revoked", "deactivated", "reactivated",
  "logged_in", "password_reset", "two_factor_enabled", "two_factor_disabled",
  "recovery_code_used", "recovery_codes_regenerated", "sessions_revoked",
  "workspace_created", "fields_updated", "stages_updated", "contact_added", "contact_removed",
  "activity_logged", "recurring_run", "attachment_added", "attachment_removed",
] as const;

/** Resource types that belong to a client, and so follow client scope. */
const CLIENT_OWNED = new Set(["Transaction", "Client", "BookMonth", "Task"]);

/** Resource types only a workspace-wide reader should see at all. */
const WORKSPACE_LEVEL = new Set(["User", "Role", "Tenant", "Brand", "Context", "Invitation"]);

export type AuditFilters = {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /** Matches the label, which is what a person actually remembers. */
  q?: string;
  from?: string;
  to?: string;
};

/**
 * The scope filter for the log.
 *
 * Somebody who can reach every client sees everything. Somebody scoped to a
 * subset sees entries about their own resources, their own actions, and
 * nothing at the workspace level — because a role change or an invitation is
 * not theirs to read.
 */
async function auditWhere(scope: Scope, extra?: Prisma.AuditEntryWhereInput): Promise<Prisma.AuditEntryWhereInput> {
  if (scope.allClients) return { AND: [extra ?? {}] };

  const db = tenantDb(scope.tenantId);

  // The ids of the client-owned things this person can reach. Resolved rather
  // than joined, because audit entries hold a resource id as plain text and
  // have no foreign key to follow.
  const [transactions, tasks, months] = await Promise.all([
    db.transaction.findMany({ where: { clientId: { in: [...scope.clientIds] } }, select: { id: true }, take: 5000 }),
    db.task.findMany({ where: { clientId: { in: [...scope.clientIds] } }, select: { id: true }, take: 5000 }),
    db.bookMonth.findMany({ where: { clientId: { in: [...scope.clientIds] } }, select: { id: true }, take: 5000 }),
  ]);

  const reachable = [
    ...scope.clientIds,
    ...transactions.map((t) => t.id),
    ...tasks.map((t) => t.id),
    ...months.map((m) => m.id),
  ];

  return {
    AND: [
      {
        OR: [
          // Things they can reach.
          { resourceType: { in: [...CLIENT_OWNED] }, resourceId: { in: reachable } },
          // Their own actions, whatever they were about.
          { actorId: scope.userId },
        ],
        // Never the workspace-level entries.
        NOT: { resourceType: { in: [...WORKSPACE_LEVEL] } },
      },
      extra ?? {},
    ],
  };
}

function filterWhere(filters: AuditFilters): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};

  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.resourceId) where.resourceId = filters.resourceId;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
    };
  }

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { resourceLabel: { contains: q, mode: "insensitive" } },
      { resourceId: q },
      { action: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function searchAudit(scope: Scope, filters: AuditFilters = {}, take = 100) {
  const where = await auditWhere(scope, filterWhere(filters));

  return tenantDb(scope.tenantId).auditEntry.findMany({
    where,
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** The trail for one resource, which is what "who changed this" means. */
export async function auditFor(scope: Scope, resourceType: string, resourceId: string, take = 50) {
  const entries = await searchAudit(scope, { resourceType, resourceId }, take);

  // An empty trail for a resource the caller cannot see, and an empty trail
  // for one that simply has no history, must look the same.
  if (entries.length === 0 && !scope.allClients) {
    const exists = await tenantDb(scope.tenantId).auditEntry.count({ where: { resourceType, resourceId } });
    if (exists > 0) throw new NotFoundError();
  }

  return entries;
}

/** Counts by action and by actor, for the summary above the search. */
export async function auditSummary(scope: Scope, filters: AuditFilters = {}) {
  const db = tenantDb(scope.tenantId);
  const where = await auditWhere(scope, filterWhere(filters));

  const [byAction, byActor, total] = await Promise.all([
    db.auditEntry.groupBy({ by: ["action"], where, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 10 }),
    db.auditEntry.groupBy({ by: ["actorId"], where, _count: { _all: true }, orderBy: { _count: { actorId: "desc" } }, take: 10 }),
    db.auditEntry.count({ where }),
  ]);

  const actorIds = byActor.map((a) => a.actorId).filter(Boolean) as string[];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  return {
    total,
    byAction: byAction.map((row) => ({ action: row.action, count: row._count._all })),
    byActor: byActor.map((row) => ({
      actorId: row.actorId,
      // A deleted account keeps its entries; the FK is SetNull, which is what
      // makes the log survive an offboarding.
      name: row.actorId ? (nameById.get(row.actorId) ?? "Removed account") : "System",
      count: row._count._all,
    })),
  };
}
