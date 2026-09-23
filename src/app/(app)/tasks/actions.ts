"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { isManager, TASK_STATUSES } from "@/lib/constants";
import { fromDateInput, startOfDay } from "@/lib/dates";
import { computeDaysLate, nextDueDate } from "@/lib/task-logic";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const optionalDate = z.union([z.literal(""), dateInput]).optional();

const taskSchema = z.object({
  name: z.string().trim().min(2, "Task Name is required.").max(200),
  assigneeId: z.string().min(1, "Please select a valid assignee."),
  status: z.enum(TASK_STATUSES),
  dueDate: dateInput,
  completedAt: optionalDate,
  verifiedById: z.string().optional(),
  docUrl: z
    .union([z.literal(""), z.string().trim().url("Task Submit Doc must be a link starting with http:// or https://")])
    .optional(),
  notes: z.string().trim().max(2000).optional(),
  recurring: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  frequency: z.string().optional(),
  weekday: z.string().optional(),
  recurringStart: optionalDate,
  recurringEnd: optionalDate,
});

export type TaskInput = z.input<typeof taskSchema>;

function done() {
  revalidatePath("/", "layout");
}

/** Shapes the validated form into the columns we store. */
async function prepare(input: z.output<typeof taskSchema>) {
  const assignee = await db.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, active: true } });
  if (!assignee || !assignee.active) throw new UserError("Please select a valid assignee.");

  if (input.verifiedById) {
    const verifier = await db.user.findUnique({ where: { id: input.verifiedById }, select: { role: true } });
    if (!verifier || !isManager(verifier.role)) throw new UserError("Only a manager can be selected as verifier.");
  }

  const recurring = input.recurring;
  let frequency: string | null = null;
  let weekday: number | null = null;

  if (recurring) {
    if (input.frequency !== "Daily" && input.frequency !== "Weekly") throw new UserError("Invalid recurring frequency.");
    frequency = input.frequency;
    if (frequency === "Weekly") {
      const day = Number(input.weekday);
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new UserError("Please select a valid weekly day.");
      weekday = day;
    }
  }

  const dueDate = startOfDay(fromDateInput(input.dueDate));
  const recurringStart = recurring ? startOfDay(fromDateInput(input.recurringStart || input.dueDate)) : null;
  const recurringEnd = recurring && input.recurringEnd ? startOfDay(fromDateInput(input.recurringEnd)) : null;
  if (recurringStart && recurringEnd && recurringEnd < recurringStart) {
    throw new UserError("Recurring End Date must be after the Start Date.");
  }

  return {
    name: input.name,
    assigneeId: input.assigneeId,
    status: input.status,
    dueDate,
    verifiedById: input.verifiedById || null,
    docUrl: input.docUrl || null,
    notes: input.notes || null,
    recurring,
    frequency,
    weekday,
    recurringStart,
    recurringEnd,
  };
}

export async function createTask(raw: TaskInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) throw new UserError("Only managers can create tasks.");
    const input = taskSchema.parse(raw);
    const data = await prepare(input);

    const completedAt = input.status === "Completed" ? startOfDay(input.completedAt ? fromDateInput(input.completedAt) : new Date()) : null;
    const task = await db.task.create({
      data: {
        ...data,
        completedAt,
        daysLate: completedAt ? computeDaysLate(data.dueDate, completedAt) : null,
        createdById: user.id,
      },
    });

    if (task.status === "Completed" && task.recurring) await createNextOccurrence(task.id, user);
    done();
    return { ok: true, data: { id: task.id }, message: "Task created" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateTask(id: string, raw: TaskInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const existing = await db.task.findUnique({ where: { id } });
    if (!existing) throw new UserError("Task could not be found.");

    const manager = isManager(user.role);
    if (!manager && existing.assigneeId !== user.id) throw new UserError("You can only update your own tasks.");

    const input = taskSchema.parse(raw);
    const data = await prepare(input);

    // Members may move their own work along and attach a submission, nothing else.
    const patch = manager
      ? data
      : {
          status: data.status,
          docUrl: data.docUrl,
          notes: data.notes,
        };

    const status = patch.status ?? existing.status;
    const dueDate = manager ? data.dueDate : existing.dueDate;

    let completedAt: Date | null = null;
    let daysLate: number | null = null;
    if (status === "Completed") {
      completedAt = startOfDay(input.completedAt ? fromDateInput(input.completedAt) : (existing.completedAt ?? new Date()));
      daysLate = computeDaysLate(dueDate, completedAt);
    }

    const updated = await db.task.update({
      where: { id },
      data: { ...patch, completedAt, daysLate },
    });

    const justCompleted = updated.status === "Completed" && existing.status !== "Completed";
    if (justCompleted && updated.recurring) await createNextOccurrence(updated.id, user);

    done();
    return { ok: true, message: justCompleted ? "Task completed" : "Task updated" };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Creates the ONE next occurrence of a recurring task. Never pre-creates a
 * series, never duplicates: the nextCreated flag and a lookup both guard it,
 * so running twice is harmless.
 */
async function createNextOccurrence(taskId: string, user: CurrentUser): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !task.recurring || task.nextCreated) return;
  if (task.status === "Blocked") return; // a blocked chain must be resolved first

  const next = nextDueDate(task);
  if (!next) {
    await db.task.update({ where: { id: task.id }, data: { nextCreated: true } });
    return;
  }

  const duplicate = await db.task.findFirst({
    where: { name: task.name, assigneeId: task.assigneeId, dueDate: next, id: { not: task.id } },
    select: { id: true },
  });

  if (!duplicate) {
    await db.task.create({
      data: {
        name: task.name,
        assigneeId: task.assigneeId,
        status: "Not Started",
        dueDate: next,
        notes: task.notes, // instructions carry over
        docUrl: null, // each occurrence needs its own submission
        verifiedById: null,
        recurring: true,
        frequency: task.frequency,
        weekday: task.weekday,
        recurringStart: task.recurringStart,
        recurringEnd: task.recurringEnd,
        createdById: user.id,
      },
    });
  }

  await db.task.update({ where: { id: task.id }, data: { nextCreated: true } });
}

export async function deleteTask(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) throw new UserError("Only managers can delete tasks.");
    await db.task.delete({ where: { id } });
    done();
    return { ok: true, message: "Task deleted" };
  } catch (err) {
    return toActionError(err);
  }
}
