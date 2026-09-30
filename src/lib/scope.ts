import "server-only";
import type { Prisma } from "@prisma/client";
import type { PermissionKey } from "./permissions";

/**
 * Scope: who is asking, what they may do, and which records those actions reach.
 *
 * Role and scope are separate axes. The role says what actions are possible
 * (`permissions`); the scope says which clients those actions touch
 * (`allClients` / `clientIds`). A Manager with expense:approve still cannot
 * approve an expense on a client they are not assigned to.
 *
 * Every repository function takes this object as its first argument. That is
 * the point: a query that reaches records cannot be written without saying
 * whose eyes it is written for.
 */
export type Scope = {
  userId: string;
  tenantId: string;
  roleName: string;
  permissions: ReadonlySet<string>;
  allClients: boolean;
  /** Meaningful only when allClients is false. */
  clientIds: readonly string[];
  /** The second axis: which pipelines this person may see into. */
  allContexts: boolean;
  /** Meaningful only when allContexts is false. */
  contextIds: readonly string[];
};

/**
 * Out of scope and does not exist return the same thing, so scope cannot be
 * mapped by probing IDs. The API turns this into a 404 either way.
 */
export class NotFoundError extends Error {
  name = "NotFoundError";
  constructor(message = "Not found.") {
    super(message);
  }
}

/** A permission the role does not hold. Distinct from NotFound: the resource
 *  was never identified, so nothing is leaked by saying the action is denied. */
export class PermissionError extends Error {
  name = "PermissionError";
  constructor(public readonly permission: string) {
    super("You don't have permission to do that.");
  }
}

export function can(scope: Scope, permission: PermissionKey): boolean {
  return scope.permissions.has(permission);
}

export function canAny(scope: Scope, ...permissions: PermissionKey[]): boolean {
  return permissions.some((p) => scope.permissions.has(p));
}

/** Throws unless the role holds the permission. Use at the top of every action. */
export function requirePermission(scope: Scope, permission: PermissionKey): void {
  if (!scope.permissions.has(permission)) throw new PermissionError(permission);
}

/**
 * The `where` fragment that limits a query to the clients this user may reach.
 * Spread it into any query on a table that hangs off a client.
 *
 *   where: { ...clientScope(scope), bookMonth: month }
 *
 * A user with no scope and no allClients grant matches nothing — an empty
 * `in` list, not an absent filter.
 */
export function clientScope(scope: Scope): { clientId?: Prisma.StringFilter | string } {
  if (scope.allClients) return {};
  return { clientId: { in: [...scope.clientIds] } };
}

/**
 * The same shape, for pipelines.
 *
 * Client and context are separate axes because they answer different
 * questions. A Manager who runs two clients may still be trusted with the whole
 * KOL pipeline, and a Finance lead who sees every client's money has no reason
 * to read the investor conversations. Deriving one from the other would force a
 * wrong answer on one of those two people.
 */
export function contextScope(scope: Scope): { contextId?: Prisma.StringFilter } {
  if (scope.allContexts) return {};
  return { contextId: { in: [...scope.contextIds] } };
}

/** The same limit, expressed for a query on the contexts table itself. */
export function contextIdScope(scope: Scope): { id?: Prisma.StringFilter } {
  if (scope.allContexts) return {};
  return { id: { in: [...scope.contextIds] } };
}

/** Whether one pipeline is readable at all. */
export function canSeeContext(scope: Scope, contextId: string): boolean {
  return scope.allContexts || scope.contextIds.includes(contextId);
}

/**
 * Guard for a single relationship reached by id, by the context it sits in.
 * NotFound rather than forbidden, exactly as with clients.
 */
export function assertContextInScope(scope: Scope, contextId: string | null | undefined): void {
  if (!contextId) return;
  if (!canSeeContext(scope, contextId)) throw new NotFoundError();
}

/** The same limit, expressed for a query on the clients table itself. */
export function clientIdScope(scope: Scope): { id?: Prisma.StringFilter } {
  if (scope.allClients) return {};
  return { id: { in: [...scope.clientIds] } };
}

/**
 * Guard for a single record reached by id. Throws NotFound — never "forbidden"
 * — when the client is outside scope, so the two cases are indistinguishable.
 */
export function assertClientInScope(scope: Scope, clientId: string | null | undefined): void {
  if (!clientId) return;
  if (scope.allClients) return;
  if (!scope.clientIds.includes(clientId)) throw new NotFoundError();
}

/** True when the user may see figures across the whole organisation. */
export function seesEverything(scope: Scope): boolean {
  return scope.allClients && can(scope, "dashboard:view_all");
}

/** What a dashboard may aggregate over, given the three dashboard permissions. */
export function dashboardReach(scope: Scope): "all" | "scoped" | "own" | "none" {
  if (can(scope, "dashboard:view_all")) return "all";
  if (can(scope, "dashboard:view_scoped")) return "scoped";
  if (can(scope, "dashboard:view_own")) return "own";
  return "none";
}
