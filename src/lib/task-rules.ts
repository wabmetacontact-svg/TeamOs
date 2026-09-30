/**
 * The two rules that make task recurrence and lateness correct, kept apart
 * from the database so they can be tested as arithmetic.
 *
 * Both are about dates, and dates are where this kind of module usually goes
 * wrong — because a `Date` is an instant, and "late" and "due tomorrow" are
 * not questions about instants. A task due on the 20th is not due at midnight
 * UTC; it is due on the 20th *where the team is*. Comparing timestamps makes
 * a task due at 23:00 IST on the 20th appear a day early to anyone computing
 * in UTC, and a task completed at 00:30 IST on the 21st appear on time.
 *
 * So everything here reduces to a yyyy-MM-dd string in the tenant's timezone
 * first, and compares those.
 */

/** The calendar date an instant falls on, in a given timezone. */
export function dateOnly(instant: Date, timeZone: string): string {
  // en-CA gives yyyy-MM-dd, which sorts and subtracts correctly as a string.
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    // An unknown timezone should not take the page down with it.
    return instant.toISOString().slice(0, 10);
  }
}

/** Whole days from one calendar date to another. Negative means before. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How late a completion was, in days, never negative.
 *
 * Finishing early is not "minus two days late" — it is on time. Storing a
 * negative would make every average across a team meaningless, because early
 * work would silently cancel out late work.
 */
export function lateness(dueDate: Date, completedAt: Date, timeZone: string): number {
  const due = dateOnly(dueDate, timeZone);
  const done = dateOnly(completedAt, timeZone);
  return Math.max(0, daysBetween(due, done));
}

export type Recurrence = {
  recurring: boolean;
  frequency: string | null;
  /** 0 = Sunday … 6 = Saturday. Weekly rules only. */
  weekday: number | null;
  recurringEnd: Date | null;
};

/**
 * When the next occurrence of a recurring task is due.
 *
 * The rule the gate turns on: **the next due date is computed from this one's
 * due date, never from when it was actually finished.** A daily task due on
 * the 20th and completed on the 27th produces one due on the 21st — because
 * the 21st's work still needed doing, and dating it the 28th would quietly
 * erase a week of missed occurrences from the record.
 *
 * Returns null when the series has ended.
 */
export function nextDueDate(due: Date, rule: Recurrence, timeZone: string): Date | null {
  if (!rule.recurring) return null;

  const dueDate = dateOnly(due, timeZone);
  let nextDate: string;

  if (rule.frequency === "Daily") {
    nextDate = addDays(dueDate, 1);
  } else if (rule.frequency === "Weekly") {
    if (rule.weekday == null) {
      nextDate = addDays(dueDate, 7);
    } else {
      // The next time that weekday comes round. Always forward, never today:
      // a weekly task due on a Monday recurs the following Monday.
      const current = weekdayOf(dueDate);
      const forward = (rule.weekday - current + 7) % 7 || 7;
      nextDate = addDays(dueDate, forward);
    }
  } else {
    return null;
  }

  if (rule.recurringEnd && nextDate > dateOnly(rule.recurringEnd, timeZone)) return null;

  return dueDateFrom(nextDate, timeZone);
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a yyyy-MM-dd string. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * A yyyy-MM-dd back to the instant a due date is stored at: midday in the
 * tenant's own timezone.
 *
 * Midnight would be wrong — a date stored at 00:00Z reads as the previous day
 * anywhere west of Greenwich. Midday UTC is better and still wrong: timezones
 * run from UTC−12 to UTC+14, a 26-hour span, so no instant is the same
 * calendar date everywhere. Midday UTC reads as the next day in Auckland,
 * which would put every due date in a New Zealand workspace one day out.
 *
 * Midday *in the tenant's timezone* is the thing that actually round-trips:
 * `dateOnly(dueDateFrom(d, tz), tz)` is `d`, for every timezone and every
 * date, which is the only property the rest of this module needs.
 */
export function dueDateFrom(date: string, timeZone: string): Date {
  const candidate = new Date(`${date}T12:00:00.000Z`);

  // How far the naive guess lands from the date we meant, read where the team
  // is. Zero almost everywhere; ±1 at the edges of the map.
  const drift = daysBetween(dateOnly(candidate, timeZone), date);
  if (drift !== 0) candidate.setUTCDate(candidate.getUTCDate() + drift);

  return candidate;
}

export const TASK_STATUSES = ["Not Started", "In Progress", "In Review", "Blocked", "Completed"] as const;
export const TASK_PRIORITIES = ["Urgent", "High", "Medium", "Low"] as const;
export const TASK_FREQUENCIES = ["Daily", "Weekly"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Statuses a task can move to from where it is. */
export function allowedTransitions(from: string): TaskStatus[] {
  switch (from) {
    case "Completed":
      // Reopening is allowed — work comes back. Everything else would mean
      // creating a duplicate task, which loses the history.
      return ["In Progress", "In Review"];
    case "In Review":
      return ["In Progress", "Blocked", "Completed"];
    case "Blocked":
      return ["Not Started", "In Progress"];
    default:
      return ["Not Started", "In Progress", "In Review", "Blocked", "Completed"];
  }
}

/**
 * Whether a task is overdue, as a question about dates rather than instants.
 * A task due today is not late, however late in the day it is.
 */
export function isOverdue(dueDate: Date, status: string, timeZone: string, now = new Date()): boolean {
  if (status === "Completed") return false;
  return dateOnly(dueDate, timeZone) < dateOnly(now, timeZone);
}
