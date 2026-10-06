import { DOW, DOWL, addDays, dLabel, dayDiff, weekday } from "./format";

/**
 * Recurring tasks.
 *
 * A rule says on which days a task repeats. Each occurrence becomes its own
 * task on the day it falls due — never a batch of future rows — so a missed
 * day stays on the board as a late task instead of silently disappearing.
 */

export type Freq = "daily" | "weekdays" | "weekly" | "every";

export type Rule = {
  freq: Freq;
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  weekday: number | null;
  /** For "every N days". */
  everyDays: number;
  /** HH:MM, optional. */
  time: string | null;
  start: string;
  until: string | null;
  /** Days whose task was deleted; they do not occur again. */
  skip?: string[];
};

export function occurs(r: Rule, d: string): boolean {
  if (d < r.start || (r.until && d > r.until)) return false;
  if (r.skip?.includes(d)) return false;
  const wd = weekday(d);
  switch (r.freq) {
    case "daily":
      return true;
    case "weekdays":
      return wd > 0 && wd < 6;
    case "weekly":
      return wd === (r.weekday ?? weekday(r.start));
    case "every":
      return dayDiff(d, r.start) % Math.max(1, r.everyDays || 1) === 0;
  }
}

/** The first day on or after `from` that the rule falls on, within a year. */
export function nextOccurrence(r: Rule, from: string): string | null {
  let d = from;
  for (let i = 0; i < 400; i++) {
    if (r.until && d > r.until) return null;
    if (occurs(r, d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

/** Every day the rule falls on from its start up to and including `through`. */
export function occurrencesThrough(r: Rule, through: string, max = 400): string[] {
  const out: string[] = [];
  for (let d = r.start; d <= through && out.length < max; d = addDays(d, 1)) {
    if (r.until && d > r.until) break;
    if (occurs(r, d)) out.push(d);
  }
  return out;
}

export const ruleShort = (r: Rule) =>
  r.freq === "daily" ? "Daily" : r.freq === "weekdays" ? "Weekdays" : r.freq === "weekly" ? "Weekly" : `Every ${r.everyDays}d`;

export function ruleText(r: Rule): string {
  const base =
    r.freq === "daily"
      ? "Every day"
      : r.freq === "weekdays"
        ? "Every weekday, Monday to Friday"
        : r.freq === "weekly"
          ? `Every ${DOWL[r.weekday ?? weekday(r.start)]}`
          : `Every ${r.everyDays} days`;
  return base + (r.time ? ` at ${r.time}` : "") + (r.until ? `, until ${dLabel(r.until)}` : "");
}

export const nextLabel = (d: string | null) => (d ? `Next ${DOW[weekday(d)]}, ${dLabel(d)}` : "No more dates");
