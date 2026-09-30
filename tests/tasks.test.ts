/**
 * Stage 4 acceptance gate — tasks.
 *
 * The plan asks for two things:
 *
 *   "Completing a task due on the 20th on the 27th records the lateness **and**
 *    schedules the next occurrence on the 21st, not the 28th. Running the
 *    completion twice creates one task, not two."
 *
 * The second one is idempotence and is easy to state. The first is the one
 * that matters, and it is easy to get backwards: if the next occurrence is
 * dated from when the work was finished, a week of missed daily occurrences
 * quietly disappears from the record and the series drifts further every time
 * somebody runs late.
 *
 * (The plan's prose says "3 days late" for a task due on the 20th completed on
 * the 27th, which is seven. That number was mis-transcribed from the source
 * document; the rule tested here is the general one — whole days between the
 * two calendar dates, in the tenant's timezone, never negative.)
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { getTask, listTasks, myDay, taskCounts } from "../src/lib/tasks";
import {
  addDays,
  allowedTransitions,
  dateOnly,
  daysBetween,
  dueDateFrom,
  isOverdue,
  lateness,
  nextDueDate,
  weekdayOf,
} from "../src/lib/task-rules";
import { NotFoundError, type Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
const IST = "Asia/Kolkata";

let tenantId: string;
let alice: string;
let bob: string;
let clientA: string;
let clientB: string;

function scopeFor(userId: string, clientIds?: string[]): Scope {
  return {
    userId,
    tenantId,
    roleName: "Admin",
    permissions: new Set(["task:view", "task:create", "task:edit", "task:verify", "task:delete"]),
    allClients: clientIds === undefined,
    clientIds: clientIds ?? [],
    allContexts: true,
    contextIds: [],
  };
}

async function makeTask(data: {
  name: string;
  assigneeId: string;
  dueDate: string;
  clientId?: string;
  isPrivate?: boolean;
  recurring?: boolean;
  frequency?: string;
  weekday?: number;
  recurringEnd?: string;
  status?: string;
}) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.task.create({
      data: {
        tenantId,
        name: data.name,
        assigneeId: data.assigneeId,
        assignedById: alice,
        clientId: data.clientId ?? null,
        dueDate: dueDateFrom(data.dueDate, IST),
        estimatedMinutes: 60,
        status: data.status ?? "Not Started",
        isPrivate: data.isPrivate ?? false,
        recurring: data.recurring ?? false,
        frequency: data.frequency ?? null,
        weekday: data.weekday ?? null,
        recurringEnd: data.recurringEnd ? dueDateFrom(data.recurringEnd, IST) : null,
      },
    });
  });
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({
    data: { name: `Tasks ${suffix}`, slug: `tasks-${suffix}`, timezone: IST },
  });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
    const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });

    const a = await tx.user.create({
      data: { tenantId, email: `alice-${suffix}@test.dev`, name: "Alice", passwordHash: "x", roleId: role.id, allClients: true },
    });
    const b = await tx.user.create({
      data: { tenantId, email: `bob-${suffix}@test.dev`, name: "Bob", passwordHash: "x", roleId: role.id, allClients: true },
    });
    alice = a.id;
    bob = b.id;

    const c1 = await tx.client.create({ data: { tenantId, brandId: brand.id, name: "Client A", status: "Active" } });
    const c2 = await tx.client.create({ data: { tenantId, brandId: brand.id, name: "Client B", status: "Active" } });
    clientA = c1.id;
    clientB = c2.id;
  });
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `tasks-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("lateness is a question about dates, not instants", () => {
  test("due on the 20th, completed on the 27th, is seven days late", () => {
    const due = dueDateFrom("2026-09-20", IST);
    const done = new Date("2026-09-27T10:00:00+05:30");

    expect(lateness(due, done, IST)).toBe(7);
  });

  test("completed on the day it was due is not late, however late in the day", () => {
    const due = dueDateFrom("2026-09-20", IST);

    // 23:55 IST on the due date. An instant comparison against a due date
    // stored at midday UTC would call this late by eleven hours.
    expect(lateness(due, new Date("2026-09-20T23:55:00+05:30"), IST)).toBe(0);
    expect(lateness(due, new Date("2026-09-20T00:05:00+05:30"), IST)).toBe(0);
  });

  test("finishing early is on time, not negative days late", () => {
    const due = dueDateFrom("2026-09-20", IST);

    // A negative would make every team average meaningless: early work would
    // silently cancel out late work.
    expect(lateness(due, new Date("2026-09-18T10:00:00+05:30"), IST)).toBe(0);
  });

  test("the timezone is the tenant's, not the server's", () => {
    // 00:30 on the 21st in Kolkata is still the 20th in UTC. A task due on the
    // 20th completed at that moment is one day late for the team, whatever
    // the server thinks.
    const instant = new Date("2026-09-20T19:00:00Z"); // 00:30 IST on the 21st
    expect(dateOnly(instant, IST)).toBe("2026-09-21");
    expect(dateOnly(instant, "UTC")).toBe("2026-09-20");
    expect(lateness(dueDateFrom("2026-09-20", IST), instant, IST)).toBe(1);
  });

  test("a nonsense timezone degrades rather than throwing", () => {
    expect(() => dateOnly(new Date(), "Not/AZone")).not.toThrow();
    expect(dateOnly(new Date("2026-09-20T12:00:00Z"), "Not/AZone")).toBe("2026-09-20");
  });

  test("overdue is also a date question", () => {
    const now = new Date("2026-09-20T23:00:00+05:30");

    expect(isOverdue(dueDateFrom("2026-09-20", IST), "In Progress", IST, now)).toBe(false);
    expect(isOverdue(dueDateFrom("2026-09-19", IST), "In Progress", IST, now)).toBe(true);
    // A completed task is never overdue, whenever it was finished.
    expect(isOverdue(dueDateFrom("2026-09-01", IST), "Completed", IST, now)).toBe(false);
  });
});

describe("the next occurrence is dated from the due date", () => {
  test("daily, due on the 20th, completed on the 27th → the 21st", () => {
    // The heart of the gate. Dating it the 28th would erase a week of
    // occurrences that still needed doing.
    const next = nextDueDate(dueDateFrom("2026-09-20", IST), { recurring: true, frequency: "Daily", weekday: null, recurringEnd: null }, IST);

    expect(next).not.toBeNull();
    expect(dateOnly(next!, IST)).toBe("2026-09-21");
    expect(dateOnly(next!, IST)).not.toBe("2026-09-28");
  });

  test("weekly keeps its weekday, wherever the completion happened to land", () => {
    // 2026-09-21 is a Monday.
    expect(weekdayOf("2026-09-21")).toBe(1);

    const next = nextDueDate(
      dueDateFrom("2026-09-21", IST),
      { recurring: true, frequency: "Weekly", weekday: 1, recurringEnd: null },
      IST,
    );

    expect(dateOnly(next!, IST)).toBe("2026-09-28");
    expect(weekdayOf(dateOnly(next!, IST))).toBe(1);
  });

  test("a weekly rule on a different weekday moves to the next one of those", () => {
    // Due Monday the 21st, rule says Friday. The next Friday is the 25th.
    const next = nextDueDate(
      dueDateFrom("2026-09-21", IST),
      { recurring: true, frequency: "Weekly", weekday: 5, recurringEnd: null },
      IST,
    );

    expect(dateOnly(next!, IST)).toBe("2026-09-25");
    expect(weekdayOf("2026-09-25")).toBe(5);
  });

  test("a weekly rule never produces the same day again", () => {
    // Due Monday, rule says Monday: the next one is a week out, not today.
    const next = nextDueDate(
      dueDateFrom("2026-09-21", IST),
      { recurring: true, frequency: "Weekly", weekday: 1, recurringEnd: null },
      IST,
    );
    expect(daysBetween("2026-09-21", dateOnly(next!, IST))).toBe(7);
  });

  test("the series stops at its end date rather than running forever", () => {
    const rule = { recurring: true, frequency: "Daily", weekday: null, recurringEnd: dueDateFrom("2026-09-21", IST) };

    expect(nextDueDate(dueDateFrom("2026-09-20", IST), rule, IST)).not.toBeNull();
    // The next one would be the 22nd, past the end.
    expect(nextDueDate(dueDateFrom("2026-09-21", IST), rule, IST)).toBeNull();
  });

  test("a non-recurring task produces nothing", () => {
    expect(nextDueDate(dueDateFrom("2026-09-20", IST), { recurring: false, frequency: null, weekday: null, recurringEnd: null }, IST)).toBeNull();
    // Recurring with no frequency is a misconfiguration, not a daily task.
    expect(nextDueDate(dueDateFrom("2026-09-20", IST), { recurring: true, frequency: null, weekday: null, recurringEnd: null }, IST)).toBeNull();
  });

  test("a due date round-trips in its own workspace's timezone, at every edge of the map", () => {
    // The only property that matters, and the one the first version of this
    // got wrong: it stored midday UTC, which reads as the next day in
    // Auckland — so every due date in a New Zealand workspace was a day out.
    // No single instant is the same calendar date everywhere; timezones span
    // 26 hours.
    for (const zone of ["Asia/Kolkata", "UTC", "America/Los_Angeles", "Pacific/Auckland", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      for (const date of ["2026-09-20", "2026-01-01", "2026-12-31", "2028-02-29"]) {
        expect({ zone, date, back: dateOnly(dueDateFrom(date, zone), zone) }).toEqual({ zone, date, back: date });
      }
    }
  });

  test("the recurrence it produces round-trips too", () => {
    for (const zone of ["Asia/Kolkata", "Pacific/Auckland", "America/Los_Angeles"]) {
      const next = nextDueDate(
        dueDateFrom("2026-09-20", zone),
        { recurring: true, frequency: "Daily", weekday: null, recurringEnd: null },
        zone,
      );
      expect({ zone, next: dateOnly(next!, zone) }).toEqual({ zone, next: "2026-09-21" });
    }
  });

  test("date arithmetic crosses months and years", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(daysBetween("2026-09-20", "2026-10-01")).toBe(11);
  });
});

describe("completing twice creates one task", () => {
  test("nextCreated is what makes the second completion a no-op", async () => {
    const task = await makeTask({
      name: `Daily standup ${suffix}`,
      assigneeId: alice,
      dueDate: "2026-09-20",
      recurring: true,
      frequency: "Daily",
    });

    const db = tenantDb(tenantId);

    // The guard the action checks. Before completion it is false.
    expect(task.nextCreated).toBe(false);

    // First completion: creates the successor and sets the flag, together.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.task.create({
        data: {
          tenantId,
          name: task.name,
          assigneeId: task.assigneeId,
          assignedById: task.assignedById,
          dueDate: nextDueDate(task.dueDate, task, IST)!,
          estimatedMinutes: task.estimatedMinutes,
          recurring: true,
          frequency: task.frequency,
        },
      });
      await tx.task.update({ where: { id: task.id }, data: { status: "Completed", nextCreated: true } });
    });

    const after = await db.task.findMany({ where: { name: task.name } });
    expect(after).toHaveLength(2);

    // A second completion sees nextCreated and does nothing. This is the
    // assertion the action's `!task.nextCreated` guard rests on.
    const reread = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reread.nextCreated).toBe(true);

    const successor = after.find((t) => t.id !== task.id)!;
    expect(dateOnly(successor.dueDate, IST)).toBe("2026-09-21");
  });

  test("the flag is set even when the series has ended, so it is not retried", async () => {
    // Otherwise every later completion asks again, and a long-finished series
    // is re-evaluated forever.
    const task = await makeTask({
      name: `Ending series ${suffix}`,
      assigneeId: alice,
      dueDate: "2026-09-21",
      recurring: true,
      frequency: "Daily",
      recurringEnd: "2026-09-21",
    });

    expect(nextDueDate(task.dueDate, task, IST)).toBeNull();

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.task.update({ where: { id: task.id }, data: { status: "Completed", nextCreated: true } });
    });

    const reread = await tenantDb(tenantId).task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reread.nextCreated).toBe(true);
    expect(await tenantDb(tenantId).task.count({ where: { name: task.name } })).toBe(1);
  });
});

describe("status transitions", () => {
  test("a completed task can be reopened, but not sent back to Not Started", () => {
    // Reopening is real — work comes back. Sending it to Not Started would
    // pretend it had never been done.
    expect(allowedTransitions("Completed")).toEqual(["In Progress", "In Review"]);
    expect(allowedTransitions("Completed")).not.toContain("Not Started");
  });

  test("a blocked task cannot jump straight to completed", () => {
    // It has to be unblocked first, so the history says how it got unstuck.
    expect(allowedTransitions("Blocked")).not.toContain("Completed");
    expect(allowedTransitions("Blocked")).toContain("In Progress");
  });

  test("an ordinary task can go anywhere", () => {
    expect(allowedTransitions("Not Started")).toContain("Completed");
    expect(allowedTransitions("In Progress")).toContain("Blocked");
  });
});

describe("who can see what", () => {
  test("a private task is invisible to everybody except its own people", async () => {
    await makeTask({ name: `Private ${suffix}`, assigneeId: alice, dueDate: "2026-09-25", isPrivate: true });

    const hers = await listTasks(scopeFor(alice), { q: `Private ${suffix}` }, IST);
    expect(hers).toHaveLength(1);

    // Bob is an Admin with every permission and still does not see it.
    const his = await listTasks(scopeFor(bob), { q: `Private ${suffix}` }, IST);
    expect(his).toHaveLength(0);

    await expect(getTask(scopeFor(bob), hers[0]!.id)).rejects.toThrow(NotFoundError);
  });

  test("a task with no client is visible to somebody scoped to two clients", async () => {
    const internal = await makeTask({ name: `Internal ${suffix}`, assigneeId: bob, dueDate: "2026-09-25" });

    // Internal work belongs to nobody's client. Hiding it from a scoped
    // Manager would mean it is never done.
    const scoped = scopeFor(bob, [clientA]);
    const visible = await listTasks(scoped, { q: `Internal ${suffix}` }, IST);

    expect(visible.map((t) => t.id)).toContain(internal.id);
  });

  test("a task on a client outside the scope is not visible", async () => {
    const theirs = await makeTask({
      name: `ClientB work ${suffix}`,
      assigneeId: bob,
      dueDate: "2026-09-25",
      clientId: clientB,
    });

    const scoped = scopeFor(bob, [clientA]);

    expect(await listTasks(scoped, { q: `ClientB work ${suffix}` }, IST)).toHaveLength(0);
    await expect(getTask(scoped, theirs.id)).rejects.toThrow(NotFoundError);

    // And the same fetch succeeds for somebody who may see that client.
    await expect(getTask(scopeFor(bob, [clientA, clientB]), theirs.id)).resolves.toBeTruthy();
  });

  test("a filter cannot be used to reach a client outside the scope", async () => {
    const scoped = scopeFor(bob, [clientA]);
    // Naming the hidden client returns nothing rather than everything.
    expect(await listTasks(scoped, { clientId: clientB }, IST)).toHaveLength(0);
  });
});

describe("my day", () => {
  test("overdue comes back separately from what is due today", async () => {
    const today = dateOnly(new Date(), IST);
    const yesterday = addDays(today, -1);

    await makeTask({ name: `Late thing ${suffix}`, assigneeId: bob, dueDate: yesterday });
    await makeTask({ name: `Today thing ${suffix}`, assigneeId: bob, dueDate: today });
    await makeTask({ name: `Later thing ${suffix}`, assigneeId: bob, dueDate: addDays(today, 3) });

    const day = await myDay(scopeFor(bob), IST);

    expect(day.overdue.some((t) => t.name === `Late thing ${suffix}`)).toBe(true);
    expect(day.dueToday.some((t) => t.name === `Today thing ${suffix}`)).toBe(true);
    expect(day.upcoming.some((t) => t.name === `Later thing ${suffix}`)).toBe(true);

    // A list that puts today's work above last week's unfinished work lets
    // things rot, so the two are never mixed.
    expect(day.overdue.some((t) => t.name === `Today thing ${suffix}`)).toBe(false);
  });

  test("the counts agree with the lists", async () => {
    const counts = await taskCounts(scopeFor(bob), IST);
    const day = await myDay(scopeFor(bob), IST);

    expect(counts.overdue).toBeGreaterThanOrEqual(day.overdue.length);
    expect(counts.mine).toBeGreaterThan(0);
  });
});
