import type { ClientW, EntryW, TaskW } from "./types";

/**
 * What each person brought in.
 *
 * This lives here rather than inside the Sales tab because it is arithmetic
 * about money, and arithmetic about money is worth a test. Three rules hold:
 *
 *   1. REVENUE IS MONEY RECEIVED. Only paid entries in, never what is billed.
 *      The monthly book is reported beside it and is not income - a client on a
 *      ₹2,00,000 retainer who has paid nothing is not ₹2,00,000 of revenue, and
 *      a salesperson's figures are the first place that distinction gets lost.
 *
 *   2. A PARTIAL TOTAL SAYS SO. The caller passes the clients it may see money
 *      on. Entries for the others are not in the ledger it was given at all, so
 *      the total would quietly be short; `hiddenClients` counts them and the
 *      screen says the number is incomplete rather than looking authoritative.
 *
 *   3. CREDIT IS NOT ACCESS. A person is credited through `client.ownerId`,
 *      which has nothing to do with grants. Somebody can be credited with a
 *      client they cannot open, and that still counts here.
 */
export type SalesRow = {
  memberId: string;
  /** Clients credited to this person. */
  clients: number;
  /** Rupees actually received from them, inside the window. */
  received: number;
  /** Their clients' monthly retainers added up. The book, not income. */
  bookPerMonth: number;
  /** How many of their clients this viewer cannot see the money on. */
  hiddenClients: number;
  /**
   * Clients this person is onboarding, whoever sold them. Workload, not
   * credit: an onboarder handed ten sales did not bring in ten clients, and
   * their revenue above stays at what they sold themselves.
   */
  onboarding: number;
  tasksDone: number;
  tasksOverdue: number;
};

export type SalesInput = {
  members: { id: string }[];
  clients: ClientW[];
  ledger: EntryW[];
  tasks: TaskW[];
  /** The clients this viewer holds Finance on. */
  financeClientIds: Set<string>;
  /** Whether a yyyy-MM-dd date is inside the period being shown. */
  inWindow: (date: string) => boolean;
  /** When a task was finished, or null if it is not done. */
  doneAt: (task: TaskW) => string | null;
  /** Days late or overdue; 0 when neither. */
  lateDays: (task: TaskW) => number;
};

/**
 * One row per person who brought in a client or is onboarding one, best first.
 *
 * People with neither are left out rather than listed with zeroes: a team of
 * thirty where four sell and onboard should show four rows, not twenty-six
 * empty ones.
 */
export function salesByMember(input: SalesInput): SalesRow[] {
  const { members, clients, ledger, tasks, financeClientIds, inWindow, doneAt, lateDays } = input;

  const byOwner = new Map<string, ClientW[]>();
  const onboardingCount = new Map<string, number>();
  for (const c of clients) {
    if (c.ownerId) {
      const list = byOwner.get(c.ownerId);
      if (list) list.push(c);
      else byOwner.set(c.ownerId, [c]);
    }
    if (c.onboarderId) onboardingCount.set(c.onboarderId, (onboardingCount.get(c.onboarderId) ?? 0) + 1);
  }

  const rows: SalesRow[] = [];

  for (const member of members) {
    const mine = byOwner.get(member.id) ?? [];
    const onboarding = onboardingCount.get(member.id) ?? 0;
    if (!mine.length && !onboarding) continue;

    const ids = new Set(mine.map((c) => c.id));
    const received = ledger
      .filter((e) => e.type === "in" && e.status === "paid" && e.clientId !== null && ids.has(e.clientId) && inWindow(e.date))
      .reduce((sum, e) => sum + e.amount, 0);

    // `retainer` is null exactly when this viewer has no Finance on the client,
    // which is the same set as `hiddenClients` - so the book is the part they
    // are allowed to add up, and the gap is declared.
    const bookPerMonth = mine.reduce((sum, c) => sum + (c.retainer ?? 0), 0);
    const hiddenClients = mine.filter((c) => !financeClientIds.has(c.id)).length;

    const theirs = tasks.filter((t) => t.whoId === member.id);
    const tasksDone = theirs.filter((t) => t.status === "done" && inWindow(doneAt(t) ?? t.created)).length;
    const tasksOverdue = theirs.filter((t) => t.status !== "done" && lateDays(t) > 0).length;

    rows.push({
      memberId: member.id,
      clients: mine.length,
      received,
      bookPerMonth,
      hiddenClients,
      onboarding,
      tasksDone,
      tasksOverdue,
    });
  }

  // Most money first, then the biggest book, then the most onboarding work -
  // the order somebody reading a sales screen is looking for.
  return rows.sort((a, b) => b.received - a.received || b.clients - a.clients || b.onboarding - a.onboarding);
}

/** Clients credited to nobody, whose money therefore appears in no row above. */
export const unownedClients = (clients: ClientW[]): number => clients.filter((c) => !c.ownerId).length;
