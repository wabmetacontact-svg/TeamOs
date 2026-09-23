import { differenceInCalendarDays, format, isToday, isTomorrow, isYesterday, parse } from "date-fns";

/** Local midnight — all task and ledger dates are day-precision. */
export function startOfDay(d: Date | string = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date | string = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date | string, days: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** "2026-09" → { start, end } covering that whole month. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y!, (m ?? 1) - 1, 1, 0, 0, 0, 0);
  const end = new Date(y!, m ?? 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function currentMonth(): string {
  return format(new Date(), "yyyy-MM");
}

export function monthLabel(month: string): string {
  const { start } = monthRange(month);
  return format(start, "MMMM yyyy");
}

export function shiftMonth(month: string, by: number): string {
  const { start } = monthRange(month);
  start.setMonth(start.getMonth() + by);
  return format(start, "yyyy-MM");
}

/** The last `count` months ending at `month`, oldest first. */
export function recentMonths(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
}

export function toDateInput(d: Date | string | null | undefined): string {
  return d ? format(new Date(d), "yyyy-MM-dd") : "";
}

export function fromDateInput(value: string): Date {
  return parse(value, "yyyy-MM-dd", new Date());
}

export function fmtDate(d: Date | string | null | undefined, pattern = "d MMM yyyy"): string {
  return d ? format(new Date(d), pattern) : "—";
}

export function dayLabel(d: Date | string): string {
  const date = new Date(d);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "d MMM");
}

export function daysBetween(from: Date | string, to: Date | string): number {
  return differenceInCalendarDays(startOfDay(to), startOfDay(from));
}
