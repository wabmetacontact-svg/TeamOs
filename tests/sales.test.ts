/**
 * What each person brought in.
 *
 * No database: this is arithmetic, and the reason it is tested at all is that
 * every mistake available here is a plausible one. Billed read as received,
 * pending counted as paid, a client credited to nobody quietly dropped, a
 * viewer without Finance shown a short total as though it were the whole
 * number — each of those looks like a working screen.
 */
import { describe, expect, test } from "vitest";
import { salesByMember, unownedClients, type SalesInput } from "../src/lib/sales";
import type { ClientW, EntryW, TaskW } from "../src/lib/types";

const client = (
  id: string,
  ownerId: string | null,
  retainer: number | null = 50_000,
  onboarderId: string | null = null,
): ClientW => ({
  id,
  brandId: "b1",
  name: id,
  company: "",
  retainer,
  currency: "INR",
  services: "",
  contact: "",
  sinceDate: null,
  payDay: null,
  rates: [],
  ownerId,
  onboarderId,
});

const entry = (over: Partial<EntryW> & { clientId: string | null }): EntryW => ({
  id: Math.random().toString(36).slice(2),
  type: "in",
  date: "2026-09-10",
  desc: "payment",
  category: "WabMeta plan",
  amount: 1_799,
  status: "paid",
  paidOn: null,
  currency: null,
  orig: null,
  method: null,
  memberId: null,
  partnerId: null,
  sourceId: null,
  note: "",
  byId: "m0",
  ...over,
});

const task = (over: Partial<TaskW> & { whoId: string }): TaskW => ({
  id: Math.random().toString(36).slice(2),
  title: "t",
  brandId: "b1",
  clientId: null,
  area: "",
  byId: "m0",
  status: "todo",
  deptId: "d1",
  hours: 0,
  due: null,
  dueTime: null,
  pri: "medium",
  est: null,
  created: "2026-09-01",
  verified: false,
  seriesId: null,
  custom: {},
  hist: [],
  notes: [],
  ...over,
});

/** Everything visible, everything in the window, nothing late. */
const base = (over: Partial<SalesInput> = {}): SalesInput => ({
  members: [{ id: "ravi" }, { id: "neha" }],
  clients: [],
  ledger: [],
  tasks: [],
  financeClientIds: new Set<string>(),
  inWindow: () => true,
  doneAt: (t) => (t.status === "done" ? t.due : null),
  lateDays: () => 0,
  ...over,
});

describe("who is listed", () => {
  test("only people credited with a client", () => {
    const rows = salesByMember(
      base({ clients: [client("c1", "ravi")], financeClientIds: new Set(["c1"]) }),
    );
    expect(rows.map((r) => r.memberId)).toEqual(["ravi"]);
  });

  test("nobody at all when no client is credited", () => {
    expect(salesByMember(base({ clients: [client("c1", null)] }))).toEqual([]);
  });

  test("best first, by money and then by how many clients", () => {
    const rows = salesByMember(
      base({
        clients: [client("c1", "ravi"), client("c2", "neha"), client("c3", "neha")],
        financeClientIds: new Set(["c1", "c2", "c3"]),
        ledger: [entry({ clientId: "c1", amount: 5_000 }), entry({ clientId: "c2", amount: 1_000 })],
      }),
    );
    expect(rows.map((r) => r.memberId)).toEqual(["ravi", "neha"]);
    expect(rows[0]!.received).toBe(5_000);
  });
});

describe("what counts as revenue", () => {
  const clients = [client("c1", "ravi")];
  const financeClientIds = new Set(["c1"]);

  test("money received, added up", () => {
    const rows = salesByMember(
      base({
        clients,
        financeClientIds,
        ledger: [entry({ clientId: "c1", amount: 1_799 }), entry({ clientId: "c1", amount: 500 })],
      }),
    );
    expect(rows[0]!.received).toBe(2_299);
  });

  test("a pending entry is not revenue", () => {
    const rows = salesByMember(
      base({ clients, financeClientIds, ledger: [entry({ clientId: "c1", amount: 9_999, status: "pending" })] }),
    );
    expect(rows[0]!.received).toBe(0);
  });

  test("money going out is not revenue, and does not reduce it either", () => {
    // A refund is its own entry out. It belongs in the ledger's net, not in a
    // salesperson's "received" - that figure answers "what came in".
    const rows = salesByMember(
      base({
        clients,
        financeClientIds,
        ledger: [entry({ clientId: "c1", amount: 1_799 }), entry({ clientId: "c1", amount: 500, type: "out" })],
      }),
    );
    expect(rows[0]!.received).toBe(1_799);
  });

  test("overhead, which belongs to no client, is nobody's revenue", () => {
    const rows = salesByMember(
      base({ clients, financeClientIds, ledger: [entry({ clientId: null, amount: 100_000 })] }),
    );
    expect(rows[0]!.received).toBe(0);
  });

  test("another person's client is not counted", () => {
    const rows = salesByMember(
      base({
        clients: [client("c1", "ravi"), client("c2", "neha")],
        financeClientIds: new Set(["c1", "c2"]),
        ledger: [entry({ clientId: "c2", amount: 7_000 })],
      }),
    );
    expect(rows.find((r) => r.memberId === "ravi")!.received).toBe(0);
    expect(rows.find((r) => r.memberId === "neha")!.received).toBe(7_000);
  });

  test("the month filter applies to revenue", () => {
    const rows = salesByMember(
      base({
        clients,
        financeClientIds,
        inWindow: (d) => d.startsWith("2026-09"),
        ledger: [
          entry({ clientId: "c1", amount: 1_000, date: "2026-09-10" }),
          entry({ clientId: "c1", amount: 2_000, date: "2026-08-10" }),
        ],
      }),
    );
    expect(rows[0]!.received).toBe(1_000);
  });

  test("the monthly book is kept separate from what was received", () => {
    // The mistake this guards: reading a retainer as income. A client on a
    // 50,000 retainer who has paid nothing is zero revenue.
    const rows = salesByMember(base({ clients: [client("c1", "ravi", 50_000)], financeClientIds }));
    expect(rows[0]!.bookPerMonth).toBe(50_000);
    expect(rows[0]!.received).toBe(0);
  });
});

describe("a viewer who cannot see all the money", () => {
  test("counts the clients whose money is hidden, so the screen can say so", () => {
    const rows = salesByMember(
      base({
        clients: [client("c1", "ravi", 50_000), client("c2", "ravi", null)],
        // Finance on c1 only; c2's entries were never in the ledger they were
        // given, so their total is short and has to admit it.
        financeClientIds: new Set(["c1"]),
        ledger: [entry({ clientId: "c1", amount: 1_799 })],
      }),
    );
    expect(rows[0]!.clients).toBe(2);
    expect(rows[0]!.hiddenClients).toBe(1);
    expect(rows[0]!.received).toBe(1_799);
    // Only the part they may add up.
    expect(rows[0]!.bookPerMonth).toBe(50_000);
  });

  test("declares nothing hidden when every client is theirs to see", () => {
    const rows = salesByMember(
      base({ clients: [client("c1", "ravi")], financeClientIds: new Set(["c1"]) }),
    );
    expect(rows[0]!.hiddenClients).toBe(0);
  });
});

describe("their own work", () => {
  const clients = [client("c1", "ravi")];
  const financeClientIds = new Set(["c1"]);

  test("counts finished tasks and ones still overdue", () => {
    const rows = salesByMember(
      base({
        clients,
        financeClientIds,
        tasks: [
          task({ whoId: "ravi", status: "done", due: "2026-09-05" }),
          task({ whoId: "ravi", status: "done", due: "2026-09-06" }),
          task({ whoId: "ravi", status: "todo", due: "2026-09-01" }),
          task({ whoId: "neha", status: "done", due: "2026-09-07" }),
        ],
        lateDays: (t) => (t.status !== "done" ? 4 : 0),
      }),
    );
    expect(rows[0]!.tasksDone).toBe(2);
    expect(rows[0]!.tasksOverdue).toBe(1);
  });

  test("a finished task is counted in the month it was finished", () => {
    const rows = salesByMember(
      base({
        clients,
        financeClientIds,
        inWindow: (d) => d.startsWith("2026-09"),
        tasks: [
          task({ whoId: "ravi", status: "done", due: "2026-09-20" }),
          task({ whoId: "ravi", status: "done", due: "2026-08-20" }),
        ],
      }),
    );
    expect(rows[0]!.tasksDone).toBe(1);
  });
});

describe("a sale handed to an onboarder", () => {
  // Ravi sells, Neha onboards. The money is Ravi's; the work is Neha's.
  const clients = [client("c1", "ravi", 50_000, "neha"), client("c2", "ravi", 50_000, "neha")];
  const financeClientIds = new Set(["c1", "c2"]);
  const ledger = [entry({ clientId: "c1", amount: 2_000 }), entry({ clientId: "c2", amount: 3_000 })];

  test("the seller keeps the credit and the revenue", () => {
    const ravi = salesByMember(base({ clients, financeClientIds, ledger })).find((r) => r.memberId === "ravi")!;
    expect(ravi.clients).toBe(2);
    expect(ravi.received).toBe(5_000);
    expect(ravi.onboarding).toBe(0);
  });

  test("the onboarder is listed for the work, with none of the revenue", () => {
    // Credit is not workload. Counting a handed-over sale as the onboarder's
    // revenue would double it across the team - once for each of them.
    const neha = salesByMember(base({ clients, financeClientIds, ledger })).find((r) => r.memberId === "neha")!;
    expect(neha).toBeDefined();
    expect(neha.onboarding).toBe(2);
    expect(neha.clients).toBe(0);
    expect(neha.received).toBe(0);
    expect(neha.bookPerMonth).toBe(0);
  });

  test("the team's revenue adds up to what was received, once", () => {
    const rows = salesByMember(base({ clients, financeClientIds, ledger }));
    expect(rows.reduce((a, r) => a + r.received, 0)).toBe(5_000);
  });

  test("somebody who brought a client in alone does both", () => {
    const rows = salesByMember(
      base({ clients: [client("c1", "neha", 50_000, "neha")], financeClientIds: new Set(["c1"]) }),
    );
    expect(rows[0]).toMatchObject({ memberId: "neha", clients: 1, onboarding: 1 });
  });

  test("the seller comes before the onboarder, money first", () => {
    const rows = salesByMember(base({ clients, financeClientIds, ledger }));
    expect(rows.map((r) => r.memberId)).toEqual(["ravi", "neha"]);
  });
});

describe("clients credited to nobody", () => {
  test("are counted, because their money is in no row", () => {
    expect(unownedClients([client("c1", "ravi"), client("c2", null), client("c3", null)])).toBe(2);
  });
});
