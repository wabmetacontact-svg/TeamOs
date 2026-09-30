import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { tenantDb } from "./db";
import { sendMail } from "./mail";
import type { Scope } from "./scope";

/**
 * Notifications.
 *
 * The rule that shapes all of this: **a notification that cannot be delivered
 * must not undo the thing it was about.** An expense was approved. Whether the
 * email provider is up has nothing to do with whether the approval happened,
 * and a queue that throws into the action makes the two the same event.
 *
 * So `notify` writes rows and returns. It never throws — a caller that wraps
 * it in a try/catch has misread it, and a caller that forgets to is not
 * exposed. Delivery is a separate pass that marks rows sent or failed and
 * retries the failures with a widening gap.
 *
 * The in-app channel has no provider and cannot fail: the row *is* the
 * notification. That is why it is the default for everything.
 */

export const CHANNELS = ["in_app", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Every event that can reach somebody, with what it is for. */
export const EVENTS = {
  "expense.submitted": "An expense needs your decision",
  "expense.approved": "An expense you entered was approved",
  "expense.rejected": "An expense you entered was sent back",
  "month.closed": "A book month was closed",
  "month.reopened": "A closed book month was reopened",
  "task.assigned": "A task was put on you",
  "task.due": "A task of yours is due",
  "task.overdue": "A task of yours is late",
  "task.verified": "A task you completed was verified",
  "user.invited": "Somebody was invited to the workspace",
  "client.assigned": "You were given access to a client",
} as const;

export type EventKey = keyof typeof EVENTS;

/**
 * What reaches whom, absent an override.
 *
 * In-app for everything, because the row costs nothing and a missed
 * notification is worse than an ignored one. Email only for the handful that
 * are genuinely worth interrupting somebody's inbox for — a decision they are
 * blocking, and money moving in a period that was closed.
 */
const DEFAULTS: Record<EventKey, Channel[]> = {
  "expense.submitted": ["in_app", "email"],
  "expense.approved": ["in_app"],
  "expense.rejected": ["in_app", "email"],
  "month.closed": ["in_app"],
  "month.reopened": ["in_app", "email"],
  "task.assigned": ["in_app"],
  "task.due": ["in_app"],
  "task.overdue": ["in_app"],
  "task.verified": ["in_app"],
  "user.invited": ["in_app"],
  "client.assigned": ["in_app"],
};

/** A user's stored overrides, shaped `{ "expense.submitted": ["in_app"] }`. */
export type NotificationPrefs = Partial<Record<EventKey, Channel[]>>;

export function readPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stored = raw as Record<string, unknown>;
  const prefs: NotificationPrefs = {};

  for (const event of Object.keys(EVENTS) as EventKey[]) {
    const value = stored[event];
    if (!Array.isArray(value)) continue;
    const channels = value.filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
    // An empty array is a real choice — "send me nothing for this" — and is
    // kept as one rather than falling back to the default.
    prefs[event] = channels;
  }

  return prefs;
}

/** The channels one event reaches one person on. */
export function channelsFor(event: EventKey, prefs: NotificationPrefs): Channel[] {
  return prefs[event] ?? DEFAULTS[event] ?? ["in_app"];
}

export type NotifyInput = {
  tenantId: string;
  /** Who it is for. Duplicates and the actor themselves are dropped. */
  userIds: string[];
  event: EventKey;
  title: string;
  body?: string;
  link?: string;
  /** Not notified about their own action. */
  exceptUserId?: string;
};

/**
 * Queues a notification for each recipient on each of their channels.
 *
 * Never throws. Every failure path returns a count of zero and logs, because
 * the alternative is an approval that rolls back because an inbox was full.
 */
export async function notify(input: NotifyInput): Promise<{ queued: number }> {
  try {
    const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
    if (recipients.length === 0) return { queued: 0 };

    const db = tenantDb(input.tenantId);

    const users = await db.user.findMany({
      where: { id: { in: recipients }, status: "Active" },
      select: { id: true, notificationPrefs: true },
    });

    const rows: Prisma.NotificationCreateManyInput[] = [];

    for (const user of users) {
      for (const channel of channelsFor(input.event, readPrefs(user.notificationPrefs))) {
        rows.push({
          tenantId: input.tenantId,
          userId: user.id,
          event: input.event,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          channel,
          // In-app is delivered by existing. Anything with a provider behind
          // it starts queued and is picked up by the delivery pass.
          status: channel === "in_app" ? "sent" : "queued",
          sentAt: channel === "in_app" ? new Date() : null,
        });
      }
    }

    if (rows.length === 0) return { queued: 0 };

    await db.notification.createMany({ data: rows });
    return { queued: rows.length };
  } catch (err) {
    // The one place in this codebase that swallows an error on purpose. The
    // action that triggered this has already happened and is not in question.
    console.error(`Notification for ${input.event} could not be queued:`, err);
    return { queued: 0 };
  }
}

/** Widening gaps, so a provider having a bad minute is not hammered. */
const RETRY_AFTER_MINUTES = [1, 5, 30, 180];
export const MAX_ATTEMPTS = RETRY_AFTER_MINUTES.length;

export function nextAttemptAt(attempts: number, from = new Date()): Date | null {
  const minutes = RETRY_AFTER_MINUTES[attempts];
  if (minutes == null) return null;
  return new Date(from.getTime() + minutes * 60_000);
}

/** Whether a failed row is due for another try. */
export function isDue(notification: { attempts: number; createdAt: Date; sentAt: Date | null }, now = new Date()): boolean {
  if (notification.attempts >= MAX_ATTEMPTS) return false;
  const due = nextAttemptAt(notification.attempts - 1, notification.createdAt);
  return due == null || due <= now;
}

type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Delivers what is queued for one tenant.
 *
 * Each row is attempted independently: one provider error marks one row failed
 * and the pass continues. A loop that throws on the first bad address leaves
 * everything behind it undelivered, which is how one wrong email address stops
 * a whole workspace's notifications.
 */
export async function deliverQueued(
  tenantId: string,
  options: { limit?: number; send?: typeof sendMail } = {},
): Promise<{ sent: number; failed: number; givenUp: number }> {
  const db = tenantDb(tenantId);
  const send = options.send ?? sendMail;

  const queued = await db.notification.findMany({
    where: { status: { in: ["queued", "failed"] }, attempts: { lt: MAX_ATTEMPTS }, channel: { not: "in_app" } },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
  });

  let sent = 0;
  let failed = 0;
  let givenUp = 0;

  for (const notification of queued) {
    if (!isDue(notification)) continue;

    let delivered = false;
    try {
      const result = await send({
        to: notification.user.email,
        subject: notification.title,
        text: [notification.body, notification.link].filter(Boolean).join("\n\n") || notification.title,
      });
      delivered = result.delivered;
    } catch (err) {
      // A provider that throws is a provider that failed, not a bug here.
      console.error(`Notification ${notification.id} threw during delivery:`, err);
      delivered = false;
    }

    const attempts = notification.attempts + 1;
    const exhausted = !delivered && attempts >= MAX_ATTEMPTS;

    await db.notification.update({
      where: { id: notification.id },
      data: {
        attempts,
        status: delivered ? "sent" : "failed",
        sentAt: delivered ? new Date() : null,
      },
    });

    if (delivered) sent++;
    else if (exhausted) givenUp++;
    else failed++;
  }

  return { sent, failed, givenUp };
}

// ──────────────────────────────────────────────────────────── reading ───

export async function unreadCount(scope: Scope): Promise<number> {
  return tenantDb(scope.tenantId).notification.count({
    where: { userId: scope.userId, channel: "in_app", readAt: null },
  });
}

export async function listNotifications(scope: Scope, take = 50, client?: Db) {
  const db = client ?? tenantDb(scope.tenantId);
  return db.notification.findMany({
    // A person's own notifications only. There is no "see everyone's" view,
    // because there is no reason for one.
    where: { userId: scope.userId, channel: "in_app" },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function markRead(scope: Scope, ids?: string[]): Promise<number> {
  const result = await tenantDb(scope.tenantId).notification.updateMany({
    where: {
      userId: scope.userId,
      // In-app only, matching unreadCount. `readAt` on an email row would be
      // a claim we cannot make: nothing here knows whether an inbox was
      // opened, and a count that clears rows it cannot observe disagrees with
      // the badge that counts them.
      channel: "in_app",
      readAt: null,
      ...(ids?.length ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
