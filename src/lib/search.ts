import "server-only";
import { tenantDb } from "./db";
import { clientIdScope, clientScope, type Scope } from "./scope";
import { formatMoney } from "./money";
import { dateOnly } from "./task-rules";

/**
 * Search across everything, within what the caller can reach.
 *
 * One box, four entity types, one scope. The scope is the whole difficulty:
 * search is the single easiest place to leak, because a query that "just
 * looks in every table" is exactly what somebody writes, and the leak only
 * shows up if a test types a hidden record's name into it.
 *
 * So every branch below reuses the same scope fragment its own module uses —
 * `clientScope`, `clientIdScope`, the task privacy filter — rather than
 * inventing a filter for search. A search that needed its own rules would be a
 * second set of rules to keep in step, which is a leak waiting for a
 * refactor.
 */

export type SearchHit = {
  type: "client" | "person" | "task" | "transaction";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type SearchResults = {
  query: string;
  hits: SearchHit[];
  counts: Record<SearchHit["type"], number>;
};

const PER_TYPE = 6;

export async function searchEverything(
  scope: Scope,
  query: string,
  options: { baseCurrency?: string; timeZone?: string } = {},
): Promise<SearchResults> {
  const q = query.trim();
  const empty: SearchResults = {
    query: q,
    hits: [],
    counts: { client: 0, person: 0, task: 0, transaction: 0 },
  };

  // Two characters is the floor: one character matches most of the database
  // and tells nobody anything.
  if (q.length < 2) return empty;

  const db = tenantDb(scope.tenantId);
  const currency = options.baseCurrency ?? "INR";
  const timeZone = options.timeZone ?? "UTC";
  const contains = { contains: q, mode: "insensitive" as const };

  const [clients, people, tasks, transactions] = await Promise.all([
    db.client.findMany({
      where: {
        ...clientIdScope(scope),
        deletedAt: null,
        OR: [{ name: contains }, { legalName: contains }, { subTag: contains }],
      },
      select: { id: true, name: true, status: true, subTag: true, brand: { select: { name: true } } },
      take: PER_TYPE,
    }),

    db.person.findMany({
      where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { notes: contains }] },
      select: { id: true, name: true, email: true },
      take: PER_TYPE,
    }),

    db.task.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: contains }, { category: contains }, { notes: contains }],
        AND: [
          scope.allClients ? {} : { OR: [{ clientId: null }, { clientId: { in: [...scope.clientIds] } }] },
          // Somebody else's private task is not searchable, which is the
          // whole meaning of private.
          { OR: [{ isPrivate: false }, { assigneeId: scope.userId }, { assignedById: scope.userId }] },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        dueDate: true,
        assignee: { select: { name: true } },
        client: { select: { name: true } },
      },
      take: PER_TYPE,
    }),

    db.transaction.findMany({
      where: {
        ...clientScope(scope),
        deletedAt: null,
        OR: [{ name: contains }, { ref: contains }, { description: contains }, { tags: { has: q } }],
      },
      select: {
        id: true,
        ref: true,
        name: true,
        direction: true,
        amountBase: true,
        bookMonth: true,
        client: { select: { name: true } },
      },
      take: PER_TYPE,
    }),
  ]);

  const hits: SearchHit[] = [
    ...clients.map((c): SearchHit => ({
      type: "client",
      id: c.id,
      title: c.name,
      subtitle: [c.brand.name, c.subTag, c.status].filter(Boolean).join(" · "),
      href: `/clients/${c.id}`,
    })),

    ...people.map((p): SearchHit => ({
      type: "person",
      id: p.id,
      title: p.name,
      subtitle: p.email ?? "No email on file",
      href: `/people/${p.id}`,
    })),

    ...tasks.map((t): SearchHit => ({
      type: "task",
      id: t.id,
      title: t.name,
      subtitle: [t.status, `due ${dateOnly(t.dueDate, timeZone)}`, t.assignee.name, t.client?.name]
        .filter(Boolean)
        .join(" · "),
      href: `/tasks/${t.id}`,
    })),

    ...transactions.map((t): SearchHit => ({
      type: "transaction",
      id: t.id,
      title: t.name,
      subtitle: [
        t.ref,
        `${t.direction === "IN" ? "+" : "−"}${formatMoney(t.amountBase, currency, { compact: true })}`,
        t.client.name,
        t.bookMonth,
      ].join(" · "),
      href: `/ledger/${t.id}`,
    })),

  ];

  return {
    query: q,
    hits,
    counts: {
      client: clients.length,
      person: people.length,
      task: tasks.length,
      transaction: transactions.length,
    },
  };
}
