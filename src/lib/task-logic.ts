import { WEEKDAYS, type Frequency, type TaskStatus } from "./constants";
import { addDays, daysBetween, startOfDay } from "./dates";

/**
 * The next scheduled due date for a recurring task.
 *
 * Anchored to the SCHEDULE (the current due date), never to when the task was
 * actually completed: a task due on the 20th that is finished on the 27th still
 * repeats on the 21st. Returns null when the series has ended.
 */
export function nextDueDate(input: {
  dueDate: Date;
  frequency: string | null;
  weekday: number | null;
  recurringStart: Date | null;
  recurringEnd: Date | null;
}): Date | null {
  const due = startOfDay(input.dueDate);
  let next: Date;

  if (input.frequency === "Daily") {
    next = addDays(due, 1);
  } else if (input.frequency === "Weekly") {
    const target = input.weekday;
    if (target === null || target === undefined) {
      next = addDays(due, 7);
    } else {
      next = addDays(due, 1);
      while (next.getDay() !== target) next = addDays(next, 1);
    }
  } else {
    return null;
  }

  if (input.recurringStart && next < startOfDay(input.recurringStart)) next = startOfDay(input.recurringStart);
  if (input.recurringEnd && next > startOfDay(input.recurringEnd)) return null;
  return next;
}

/** Completed after the due date → how many days late. Never negative. */
export function computeDaysLate(dueDate: Date, completedAt: Date): number {
  return Math.max(daysBetween(dueDate, completedAt), 0);
}

/** Still open and past due → how many days overdue. 0 otherwise. */
export function computeDaysOverdue(dueDate: Date, status: string, today: Date = new Date()): number {
  if (status === "Completed") return 0;
  const diff = daysBetween(dueDate, today);
  return diff > 0 ? diff : 0;
}

export type Timing = { label: string; tone: "grey" | "green" | "red" } | null;

/** What the Timing column shows. "0 days late" is never shown — that's "On time". */
export function timingFor(task: { status: string; dueDate: Date; completedAt: Date | null; daysLate: number | null }, today: Date = new Date()): Timing {
  if (task.status === "Completed" && task.completedAt) {
    const late = task.daysLate ?? computeDaysLate(task.dueDate, task.completedAt);
    return late > 0
      ? { label: `${late} ${late === 1 ? "day" : "days"} late`, tone: "red" }
      : { label: "On time", tone: "green" };
  }
  const overdue = computeDaysOverdue(task.dueDate, task.status, today);
  if (overdue > 0) return { label: `${overdue} ${overdue === 1 ? "day" : "days"} overdue`, tone: "red" };
  return null;
}

export function weekdayName(weekday: number | null | undefined): string {
  return weekday === null || weekday === undefined ? "" : (WEEKDAYS[weekday] ?? "");
}

export function recurrenceLabel(task: { recurring: boolean; frequency: string | null; weekday: number | null }): string {
  if (!task.recurring) return "";
  if (task.frequency === "Weekly") {
    const day = weekdayName(task.weekday);
    return day ? `Weekly · ${day}` : "Weekly";
  }
  return task.frequency ?? "";
}

/** Per-person numbers for Team Performance. Descriptive only — no scoring. */
export function performanceFor(
  tasks: { status: string; dueDate: Date; completedAt: Date | null; daysLate: number | null }[],
  today: Date = new Date(),
) {
  const completed = tasks.filter((t) => t.status === "Completed");
  const lateOnes = completed.filter((t) => (t.daysLate ?? 0) > 0);
  const totalLateDays = lateOnes.reduce((sum, t) => sum + (t.daysLate ?? 0), 0);

  return {
    assigned: tasks.length,
    completed: completed.length,
    notStarted: tasks.filter((t) => t.status === "Not Started").length,
    inReview: tasks.filter((t) => t.status === "In Review").length,
    blocked: tasks.filter((t) => t.status === "Blocked").length,
    late: lateOnes.length,
    overdue: tasks.filter((t) => computeDaysOverdue(t.dueDate, t.status, today) > 0).length,
    completionPct: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
    onTimePct: completed.length ? Math.round(((completed.length - lateOnes.length) / completed.length) * 100) : 0,
    avgDaysLate: lateOnes.length ? Math.round((totalLateDays / lateOnes.length) * 10) / 10 : 0,
  };
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (["Not Started", "In Review", "Completed", "Blocked"] as string[]).includes(value);
}

export function isFrequency(value: string): value is Frequency {
  return value === "Daily" || value === "Weekly";
}
