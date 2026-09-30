/**
 * Stage 6 — notifications.
 *
 *   "A failing notification provider does not block the action that triggered
 *    it."
 *
 * This is the whole design in one sentence. An expense was approved. Whether
 * the email provider is up has nothing to do with whether the approval
 * happened — and a queue that throws into the action makes those the same
 * event, so a bad SMTP password silently becomes "approvals stopped working".
 *
 * The tests below try to break it on purpose: a provider that returns failure,
 * one that throws, one recipient who does not exist, and a mix where one
 * address fails and the rest must still go.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import {
  channelsFor,
  deliverQueued,
  EVENTS,
  isDue,
  listNotifications,
  markRead,
  MAX_ATTEMPTS,
  nextAttemptAt,
  notify,
  readPrefs,
  unreadCount,
} from "../src/lib/notifications";
import type { MailMessage, MailResult } from "../src/lib/mail";
import type { Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let alice: string;
let bob: string;
let carol: string;

function scopeFor(userId: string): Scope {
  return {
    userId,
    tenantId,
    roleName: "Admin",
    permissions: new Set<string>(),
    allClients: true,
    clientIds: [],
    allContexts: true,
    contextIds: [],
  };
}

/** A provider that does whatever the test needs it to. */
function provider(behaviour: "ok" | "fail" | "throw" | "flaky") {
  const calls: string[] = [];
  const send = async (message: MailMessage): Promise<MailResult> => {
    calls.push(message.to);
    if (behaviour === "throw") throw new Error("connection reset by peer");
    if (behaviour === "fail") return { delivered: false, reason: "mailbox full" };
    if (behaviour === "flaky") {
      // One address is broken; everything else is fine.
      if (message.to.includes("bob")) return { delivered: false, reason: "no such user" };
      return { delivered: true };
    }
    return { delivered: true };
  };
  return { send, calls };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Notif ${suffix}`, slug: `notif-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });

    const [a, b, c] = await Promise.all([
      tx.user.create({ data: { tenantId, email: `alice-${suffix}@test.dev`, name: "Alice", passwordHash: "x", roleId: role.id } }),
      tx.user.create({ data: { tenantId, email: `bob-${suffix}@test.dev`, name: "Bob", passwordHash: "x", roleId: role.id } }),
      tx.user.create({ data: { tenantId, email: `carol-${suffix}@test.dev`, name: "Carol", passwordHash: "x", roleId: role.id } }),
    ]);
    alice = a.id;
    bob = b.id;
    carol = c.id;
  });
}, 120_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `notif-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("a failing provider cannot reach back into the action", () => {
  test("queueing never throws, whatever is wrong", async () => {
    // A tenant that does not exist, a user who does not exist, an event with
    // no recipients — none of these may become an exception in the caller.
    await expect(
      notify({ tenantId: "cldoesnotexist00000", userIds: [alice], event: "expense.approved", title: "x" }),
    ).resolves.toEqual({ queued: 0 });

    await expect(
      notify({ tenantId, userIds: ["clnobody0000000000"], event: "expense.approved", title: "x" }),
    ).resolves.toEqual({ queued: 0 });

    await expect(notify({ tenantId, userIds: [], event: "expense.approved", title: "x" })).resolves.toEqual({
      queued: 0,
    });
  });

  test("a provider that throws marks the row failed and returns normally", async () => {
    await notify({ tenantId, userIds: [alice], event: "expense.submitted", title: `Throw ${suffix}` });

    const broken = provider("throw");
    const result = await deliverQueued(tenantId, { send: broken.send });

    // The pass completes. The action that queued this finished long ago.
    expect(result.failed).toBeGreaterThan(0);
    expect(broken.calls.length).toBeGreaterThan(0);

    const row = await tenantDb(tenantId).notification.findFirstOrThrow({
      where: { title: `Throw ${suffix}`, channel: "email" },
    });
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.sentAt).toBeNull();
  });

  test("one bad address does not stop the others", async () => {
    // The failure mode this guards against: a loop that throws on the first
    // bad recipient and leaves everybody behind it undelivered, so one wrong
    // address stops a whole workspace's notifications.
    await notify({
      tenantId,
      userIds: [alice, bob, carol],
      event: "expense.submitted",
      title: `Flaky ${suffix}`,
    });

    const flaky = provider("flaky");
    const result = await deliverQueued(tenantId, { send: flaky.send });

    expect(result.sent).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const rows = await tenantDb(tenantId).notification.findMany({
      where: { title: `Flaky ${suffix}`, channel: "email" },
      include: { user: { select: { name: true } } },
    });

    const byName = new Map(rows.map((r) => [r.user.name, r.status]));
    expect(byName.get("Bob")).toBe("failed");
    expect(byName.get("Alice")).toBe("sent");
    expect(byName.get("Carol")).toBe("sent");
  });

  test("the in-app copy arrives whatever the provider does", async () => {
    // It has no provider to fail. The row is the notification, which is why
    // it is the default for everything.
    const rows = await tenantDb(tenantId).notification.findMany({
      where: { title: `Flaky ${suffix}`, channel: "in_app" },
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });
});

describe("retry", () => {
  test("the gaps widen rather than hammering a provider having a bad minute", () => {
    const from = new Date("2026-09-30T10:00:00Z");

    const gaps = Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
      const at = nextAttemptAt(i, from)!;
      return Math.round((at.getTime() - from.getTime()) / 60_000);
    });

    expect(gaps).toEqual([1, 5, 30, 180]);
    // Strictly increasing: a fixed interval is how a queue turns an outage
    // into a denial of service against its own provider.
    expect(gaps.every((g, i) => i === 0 || g > gaps[i - 1]!)).toBe(true);
  });

  test("it gives up rather than retrying forever", () => {
    expect(nextAttemptAt(MAX_ATTEMPTS)).toBeNull();
    expect(isDue({ attempts: MAX_ATTEMPTS, createdAt: new Date(2020, 0, 1), sentAt: null })).toBe(false);
  });

  test("a row that has just failed is not retried immediately", () => {
    const justNow = { attempts: 1, createdAt: new Date(), sentAt: null };
    expect(isDue(justNow)).toBe(false);

    const anHourAgo = { attempts: 1, createdAt: new Date(Date.now() - 3600_000), sentAt: null };
    expect(isDue(anHourAgo)).toBe(true);
  });

  test("delivery skips rows that have exhausted their attempts", async () => {
    const row = await tenantDb(tenantId).notification.findFirstOrThrow({
      where: { title: `Throw ${suffix}`, channel: "email" },
    });

    await tenantDb(tenantId).notification.update({
      where: { id: row.id },
      data: { attempts: MAX_ATTEMPTS, status: "failed" },
    });

    const attempt = provider("ok");
    await deliverQueued(tenantId, { send: attempt.send });

    // It is not picked up again, however healthy the provider now is.
    const after = await tenantDb(tenantId).notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(MAX_ATTEMPTS);
    expect(after.status).toBe("failed");
  });
});

describe("per-user channels", () => {
  test("an event nobody has an opinion about uses its default", () => {
    expect(channelsFor("expense.submitted", {})).toEqual(["in_app", "email"]);
    expect(channelsFor("task.assigned", {})).toEqual(["in_app"]);
  });

  test("an override replaces the default rather than adding to it", () => {
    expect(channelsFor("expense.submitted", { "expense.submitted": ["in_app"] })).toEqual(["in_app"]);
  });

  test("choosing nothing is a choice, not a fallback to the default", () => {
    // The distinction that matters: an empty array means "send me nothing for
    // this", and reading it as "no preference" would keep emailing somebody
    // who explicitly asked you to stop.
    expect(channelsFor("expense.submitted", { "expense.submitted": [] })).toEqual([]);
  });

  test("an event with no override is unaffected by one on another event", () => {
    const prefs = { "expense.submitted": [] as never[] };
    expect(channelsFor("expense.rejected", prefs)).toEqual(["in_app", "email"]);
  });

  test("stored rubbish degrades to the defaults rather than crashing a page", () => {
    expect(readPrefs(null)).toEqual({});
    expect(readPrefs("nonsense")).toEqual({});
    expect(readPrefs([1, 2, 3])).toEqual({});
    // An unknown channel is dropped; the known one beside it survives.
    expect(readPrefs({ "expense.submitted": ["in_app", "carrier_pigeon"] })).toEqual({
      "expense.submitted": ["in_app"],
    });
    // An event that is not in the catalogue is ignored entirely.
    expect(readPrefs({ "not.an.event": ["in_app"] })).toEqual({});
  });

  test("a user's stored preference is honoured when queueing", async () => {
    await tenantDb(tenantId).user.update({
      where: { id: carol },
      data: { notificationPrefs: { "month.reopened": ["in_app"] } },
    });

    await notify({ tenantId, userIds: [alice, carol], event: "month.reopened", title: `Prefs ${suffix}` });

    const rows = await tenantDb(tenantId).notification.findMany({
      where: { title: `Prefs ${suffix}` },
      include: { user: { select: { name: true } } },
    });

    // Alice takes the default, which includes email. Carol asked for in-app
    // only and gets exactly that.
    expect(rows.filter((r) => r.user.name === "Alice").map((r) => r.channel).sort()).toEqual(["email", "in_app"]);
    expect(rows.filter((r) => r.user.name === "Carol").map((r) => r.channel)).toEqual(["in_app"]);
  });

  test("every event in the catalogue has a default and a description", () => {
    for (const event of Object.keys(EVENTS) as (keyof typeof EVENTS)[]) {
      expect({ event, channels: channelsFor(event, {}).length > 0 }).toEqual({ event, channels: true });
      expect({ event, described: EVENTS[event].length > 10 }).toEqual({ event, described: true });
    }
  });
});

describe("reading them", () => {
  test("somebody sees their own and nobody else's", async () => {
    await notify({ tenantId, userIds: [alice], event: "task.assigned", title: `Mine ${suffix}` });

    const hers = await listNotifications(scopeFor(alice));
    const his = await listNotifications(scopeFor(bob));

    expect(hers.some((n) => n.title === `Mine ${suffix}`)).toBe(true);
    expect(his.some((n) => n.title === `Mine ${suffix}`)).toBe(false);
  });

  test("the actor is not notified about their own action", async () => {
    await notify({
      tenantId,
      userIds: [alice, bob],
      event: "task.assigned",
      title: `Self ${suffix}`,
      exceptUserId: alice,
    });

    const rows = await tenantDb(tenantId).notification.findMany({ where: { title: `Self ${suffix}` } });
    expect(rows.every((r) => r.userId !== alice)).toBe(true);
    expect(rows.some((r) => r.userId === bob)).toBe(true);
  });

  test("duplicated recipients get one copy, not two", async () => {
    await notify({ tenantId, userIds: [bob, bob, bob], event: "task.assigned", title: `Dupe ${suffix}` });

    const rows = await tenantDb(tenantId).notification.findMany({
      where: { title: `Dupe ${suffix}`, channel: "in_app" },
    });
    expect(rows).toHaveLength(1);
  });

  test("marking read clears the count and does not touch anybody else's", async () => {
    const before = await unreadCount(scopeFor(bob));
    expect(before).toBeGreaterThan(0);

    const aliceBefore = await unreadCount(scopeFor(alice));

    const marked = await markRead(scopeFor(bob));
    expect(marked).toBe(before);
    expect(await unreadCount(scopeFor(bob))).toBe(0);
    expect(await unreadCount(scopeFor(alice))).toBe(aliceBefore);
  });
});
