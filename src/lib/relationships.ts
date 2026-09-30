import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { contextIdScope, contextScope, NotFoundError, type Scope } from "./scope";

/**
 * People, and the relationships they hold.
 *
 * One person, many relationships. The same human can be an investor and a KOL
 * at once, each in its own pipeline, each with its own owner and stage — which
 * is the thing three separate spreadsheets could never express, and the reason
 * this module exists.
 *
 * The hard part is not the reading. It is what somebody sees when they are
 * scoped out of a pipeline. Hiding the relationship completely is safe and
 * wrong: two people then cold-approach the same investor a week apart, which is
 * the exact failure the platform is meant to end. Showing it is a leak.
 *
 * So the answer is neither: `personSummary` returns the relationships the
 * caller may read, plus a *count* of the ones they may not, and nothing about
 * them — not the context, not the owner, not the stage. Enough to know to ask;
 * never enough to know what to ask about.
 */

function relationshipWhere(scope: Scope, extra?: Prisma.RelationshipWhereInput): Prisma.RelationshipWhereInput {
  // AND for the same reason as clients: a caller's `id` must not be able to
  // replace the scope's own key. See the comment in lib/clients.ts.
  return { AND: [contextScope(scope), { deletedAt: null }, extra ?? {}] };
}

/**
 * The same, for queries on the contexts table.
 *
 * This exists because the version without it was written as a spread — `{ id,
 * ...contextIdScope(scope) }` — and the scope's `id` key overwrote the caller's,
 * so asking for a pipeline you may not see returned the first one you may.
 * Not a refusal and not an empty result: a different pipeline's numbers under
 * the name you asked for. Third time this shape of bug has appeared, so it is
 * a function now rather than a line anyone writes again.
 */
function contextWhere(scope: Scope, extra?: Prisma.ContextWhereInput): Prisma.ContextWhereInput {
  return { AND: [contextIdScope(scope), extra ?? {}] };
}

export type RelationshipFilters = {
  contextId?: string;
  stageId?: string;
  ownerId?: string;
  clientId?: string;
  /** Matches the person's name, email and company-ish notes. */
  q?: string;
  includeTerminal?: boolean;
};

function filterWhere(scope: Scope, filters: RelationshipFilters): Prisma.RelationshipWhereInput {
  const extra: Prisma.RelationshipWhereInput = {};

  if (filters.contextId) extra.contextId = filters.contextId;
  if (filters.stageId) extra.stageId = filters.stageId;
  if (filters.ownerId) extra.ownerId = filters.ownerId;
  if (filters.clientId) extra.clientId = filters.clientId;
  if (!filters.includeTerminal && !filters.stageId) extra.stage = { isTerminal: false };

  const q = filters.q?.trim();
  if (q) {
    extra.person = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  return relationshipWhere(scope, extra);
}

/** The pipeline board: every relationship the caller may read. */
export async function listRelationships(scope: Scope, filters: RelationshipFilters = {}) {
  return tenantDb(scope.tenantId).relationship.findMany({
    where: filterWhere(scope, filters),
    include: {
      person: { select: { id: true, name: true, email: true, phone: true } },
      context: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, position: true, isTerminal: true } },
      owner: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      _count: { select: { activities: true } },
    },
    orderBy: [{ stage: { position: "asc" } }, { updatedAt: "desc" }],
  });
}

/** One relationship, or an indistinguishable 404. */
export async function getRelationship(scope: Scope, id: string) {
  const relationship = await tenantDb(scope.tenantId).relationship.findFirst({
    where: relationshipWhere(scope, { id }),
    include: {
      person: true,
      context: { include: { stages: { orderBy: { position: "asc" } } } },
      stage: true,
      owner: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
      stageHistory: {
        include: {
          fromStage: { select: { name: true } },
          toStage: { select: { name: true } },
          actor: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      activities: {
        include: { actor: { select: { name: true } } },
        orderBy: { occurredAt: "desc" },
        take: 50,
      },
    },
  });

  if (!relationship) throw new NotFoundError();
  return relationship;
}

export type PersonSummary = Awaited<ReturnType<typeof personSummary>>;

/**
 * A person, with the relationships this caller may read and a bare count of
 * the ones they may not.
 *
 * `hiddenCount` is the awareness banner's entire payload, and it is deliberately
 * a number and nothing else. A context name would say which pipeline; an owner
 * would say who to ask and imply what for; a stage would say how far along it
 * is. A count says only "somebody here already knows this person", which is
 * what stops the duplicate approach without disclosing the deal.
 */
export async function personSummary(scope: Scope, personId: string) {
  const db = tenantDb(scope.tenantId);

  const person = await db.person.findFirst({
    where: { id: personId, deletedAt: null },
    include: {
      contacts: {
        include: { client: { select: { id: true, name: true } } },
        orderBy: { addedAt: "asc" },
      },
    },
  });
  if (!person) throw new NotFoundError();

  // Two counts against the same person: what is visible, and how many exist in
  // total. The difference is the banner. Counting rather than fetching the
  // hidden ones means nothing about them is ever loaded into this process.
  const [visible, total] = await Promise.all([
    db.relationship.findMany({
      where: relationshipWhere(scope, { personId }),
      include: {
        context: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, isTerminal: true } },
        owner: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.relationship.count({ where: { personId, deletedAt: null } }),
  ]);

  // Activities follow the relationship they belong to. One with no
  // relationship is a plain note about the person and is readable by anyone
  // who can see the person.
  const activities = await db.activity.findMany({
    where: {
      personId,
      OR: [{ relationshipId: null }, { relationship: relationshipWhere(scope) }],
    },
    include: {
      actor: { select: { name: true } },
      relationship: { select: { id: true, context: { select: { name: true } } } },
    },
    orderBy: { occurredAt: "desc" },
    take: 50,
  });

  return { person, relationships: visible, hiddenCount: total - visible.length, activities };
}

/** The directory: every person, with how many relationships each one holds. */
export async function listPeople(scope: Scope, filters: { q?: string; contextId?: string } = {}) {
  const db = tenantDb(scope.tenantId);
  const q = filters.q?.trim();

  const people = await db.person.findMany({
    where: {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      // Filtering by pipeline can only ever narrow to pipelines the caller
      // already sees, so this cannot be used to enumerate a hidden one.
      ...(filters.contextId ? { relationships: { some: relationshipWhere(scope, { contextId: filters.contextId }) } } : {}),
    },
    include: {
      relationships: {
        where: relationshipWhere(scope),
        select: { id: true, context: { select: { name: true } }, stage: { select: { name: true } } },
      },
      _count: { select: { relationships: { where: { deletedAt: null } }, contacts: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  return people.map((person) => ({
    ...person,
    // Same arithmetic as personSummary, for the row in the list.
    hiddenCount: person._count.relationships - person.relationships.length,
  }));
}

/**
 * Finds a person by email the way the dedupe index does — case-insensitively,
 * ignoring soft-deleted rows. Used before creating one, so the common path is
 * a match rather than a caught constraint violation.
 */
export async function findPersonByEmail(scope: Scope, email: string) {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return null;

  return tenantDb(scope.tenantId).person.findFirst({
    where: { email: { equals: cleaned, mode: "insensitive" }, deletedAt: null },
  });
}

/** The pipelines this caller may see, with their stages. */
export async function listContexts(scope: Scope) {
  return tenantDb(scope.tenantId).context.findMany({
    where: contextWhere(scope),
    include: {
      stages: { orderBy: { position: "asc" } },
      _count: { select: { relationships: { where: { deletedAt: null } } } },
    },
    orderBy: { position: "asc" },
  });
}

/**
 * Per-stage counts and values for one pipeline, for the board header. Refuses
 * a context outside scope rather than returning zeroes, so an empty board and
 * a forbidden one are not confused.
 */
export async function pipelineSummary(scope: Scope, contextId: string) {
  const db = tenantDb(scope.tenantId);

  const context = await db.context.findFirst({
    where: contextWhere(scope, { id: contextId }),
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!context) throw new NotFoundError();

  const grouped = await db.relationship.groupBy({
    by: ["stageId"],
    where: relationshipWhere(scope, { contextId }),
    _count: { _all: true },
    _sum: { value: true },
  });

  const byStage = new Map(grouped.map((g) => [g.stageId, g]));

  return {
    context,
    stages: context.stages.map((stage) => ({
      ...stage,
      count: byStage.get(stage.id)?._count._all ?? 0,
      value: byStage.get(stage.id)?._sum.value ?? 0n,
    })),
    unstaged: byStage.get(null)?._count._all ?? 0,
  };
}
