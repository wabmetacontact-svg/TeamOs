import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { clientIdScope, NotFoundError, type Scope } from "./scope";

/**
 * Every way a client can be read.
 *
 * Stage 1's gate is "a Manager scoped to two clients cannot retrieve a third
 * through the list endpoint, a direct ID fetch, search, or an export — four
 * routes, same denial". The cheapest way to pass that is not to write the check
 * four times; it is to make the four routes one function's callers.
 *
 * So `clientWhere` is the only place a client query starts, it takes a Scope
 * and nothing else will do, and list, search, get and export all go through it.
 * A fifth route added later inherits the same answer without anyone
 * remembering to add it.
 */

/**
 * The floor every client query stands on: in scope, and not deleted.
 *
 * The scope filter goes inside AND rather than being spread alongside the
 * caller's conditions, and that is not a style choice. Spreading let a caller
 * that passed `{ id }` overwrite the scope's own `id: { in: [...] }` key, so
 * fetching one client by id returned any client in the tenant while the list
 * and the search stayed correct — they never pass an `id`. Under AND, a
 * caller's condition can only ever narrow what scope permits; there is no key
 * to collide with.
 */
function clientWhere(scope: Scope, extra?: Prisma.ClientWhereInput): Prisma.ClientWhereInput {
  return { AND: [clientIdScope(scope), { deletedAt: null }, extra ?? {}] };
}

export type ClientFilters = {
  /** Matches name, legal name and sub-tag. */
  q?: string;
  brandId?: string;
  status?: string;
  /** Archived clients are hidden unless asked for — they are still real. */
  includeArchived?: boolean;
};

function filterWhere(scope: Scope, filters: ClientFilters): Prisma.ClientWhereInput {
  // Built as a separate object and handed to clientWhere, so it cannot reach
  // the scope filter even by accident.
  const extra: Prisma.ClientWhereInput = {};

  if (!filters.includeArchived && !filters.status) extra.status = { not: "Archived" };
  if (filters.status) extra.status = filters.status;
  if (filters.brandId) extra.brandId = filters.brandId;

  const q = filters.q?.trim();
  if (q) {
    // Search narrows what scope already allowed. It never widens it: this OR
    // sits inside the AND, so every branch of it is still scope-limited.
    extra.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { legalName: { contains: q, mode: "insensitive" } },
      { subTag: { contains: q, mode: "insensitive" } },
    ];
  }

  return clientWhere(scope, extra);
}

export type ClientListItem = Awaited<ReturnType<typeof listClients>>[number];

/** Route one: the list. */
export async function listClients(scope: Scope, filters: ClientFilters = {}) {
  return tenantDb(scope.tenantId).client.findMany({
    where: filterWhere(scope, filters),
    include: {
      brand: { select: { id: true, name: true, color: true } },
      _count: { select: { contacts: true, transactions: true, tasks: true, scopeGrants: true } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

/** Route two: search. The same function — the distinction is in the UI only. */
export async function searchClients(scope: Scope, q: string, limit = 10) {
  if (!q.trim()) return [];
  return tenantDb(scope.tenantId).client.findMany({
    where: filterWhere(scope, { q, includeArchived: true }),
    select: { id: true, name: true, subTag: true, status: true, brand: { select: { name: true, color: true } } },
    orderBy: { name: "asc" },
    take: limit,
  });
}

/**
 * Route three: fetch by id.
 *
 * Out of scope and does not exist both raise NotFoundError, and the caller
 * cannot tell which it was — that is the fifth gate proof from stage 0,
 * applied here. Note it is one query, not a fetch followed by a check: a fetch
 * that succeeds and is then discarded has already read the row.
 */
export async function getClient(scope: Scope, id: string) {
  const client = await tenantDb(scope.tenantId).client.findFirst({
    where: clientWhere(scope, { id }),
    include: {
      brand: true,
      contacts: {
        include: { person: { select: { id: true, name: true, email: true, phone: true } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
      scopeGrants: {
        include: { user: { select: { id: true, name: true, email: true, status: true, role: { select: { name: true } } } } },
      },
      _count: { select: { transactions: true, tasks: true, relationships: true, bookMonths: true, recurringSpends: true } },
    },
  });

  if (!client) throw new NotFoundError();
  return client;
}

/** Route four: export. Same `where`, different serialisation. */
export async function exportClients(scope: Scope, filters: ClientFilters = {}) {
  return tenantDb(scope.tenantId).client.findMany({
    where: filterWhere(scope, filters),
    include: { brand: { select: { name: true, fieldDefs: true } } },
    orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
  });
}

/**
 * The sub-tags each brand is already using, for the form's suggestion list.
 *
 * Sub-tag is free text on purpose — ARC3 divides by `Internal` and `Jay`,
 * LineUp does not divide at all, and a fixed list would be wrong for one of
 * them within a month. But free text drifts: `Internal`, `internal` and
 * `Internal ` become three tags that mean one thing and never group together.
 * Showing what already exists costs nothing and stops most of that.
 *
 * Scoped like everything else, so the suggestions cannot reveal a sub-tag from
 * a client the caller may not see.
 */
export async function brandSubTags(scope: Scope): Promise<Record<string, string[]>> {
  const rows = await tenantDb(scope.tenantId).client.findMany({
    where: clientWhere(scope, { subTag: { not: null } }),
    select: { brandId: true, subTag: true },
    distinct: ["brandId", "subTag"],
    orderBy: { subTag: "asc" },
  });

  const byBrand: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.subTag) (byBrand[row.brandId] ??= []).push(row.subTag);
  }
  return byBrand;
}

/**
 * What a client is attached to. Used to decide whether it may be deleted, and
 * shown to the person deciding — a refusal that does not say what is in the way
 * is a refusal somebody will try to work around.
 */
export async function clientDependencies(scope: Scope, id: string) {
  const db = tenantDb(scope.tenantId);
  await getClient(scope, id); // scope check first, counts second

  const [transactions, tasks, relationships, bookMonths, recurringSpends] = await Promise.all([
    db.transaction.count({ where: { clientId: id } }),
    db.task.count({ where: { clientId: id } }),
    db.relationship.count({ where: { clientId: id } }),
    db.bookMonth.count({ where: { clientId: id } }),
    db.recurringSpend.count({ where: { clientId: id } }),
  ]);

  const counts = { transactions, tasks, relationships, bookMonths, recurringSpends };
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/**
 * The client's history, read from the audit log rather than from a second
 * table that would have to be kept in step with it. The audit log already
 * records before and after for every change, is append-only at the database,
 * and covers deletion — three properties a bespoke history table would have to
 * re-earn.
 */
export async function clientHistory(scope: Scope, id: string, take = 50) {
  await getClient(scope, id);

  return tenantDb(scope.tenantId).auditEntry.findMany({
    where: { resourceType: "Client", resourceId: id },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}
