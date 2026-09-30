"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { getTask } from "@/lib/tasks";
import {
  allowedTransitions,
  dueDateFrom,
  lateness,
  nextDueDate,
  TASK_FREQUENCIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/task-rules";
import { assertClientInScope, can, NotFoundError } from "@/lib/scope";
import { notify } from "@/lib/notifications";

/**
 * Task writes.
 *
 * Three rules here are the ones worth reading before changing anything.
 *
 * **An estimate is required twice** — once when the task is created, and again
 * as an actual when it is completed. The PRD asks for this and it is the only
 * way the estimate is ever worth anything: an estimate nobody compares against
 * a real number is a number somebody typed to get past a form.
 *
 * **The next occurrence is dated from the due date**, never from when the work
 * was actually finished. A daily task due on the 20th and completed on the
 * 27th produces one due on the 21st.
 *
 * **Whoever completed it cannot verify it.** Verification exists to be a second
 * pair of eyes; letting it be the same pair makes it a checkbox.
 */

const baseFields = {
  name: z.string().trim().min(1, "What needs doing").max(200),
  assigneeId: z.string().min(1, "Somebody has to own it"),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  estimatedMinutes: z.number().int().min(1, "Even a rough estimate").max(60 * 24 * 30),
  priority: z.enum(TASK_PRIORITIES).default("Medium"),
  clientId: z.string().optional(),
  brandId: z.string().optional(),
  relationshipId: z.string().optional(),
  category: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
  docUrl: z.string().trim().max(500).optional(),
  isPrivate: z.boolean().default(false),
  recurring: z.boolean().default(false),
  frequency: z.enum(TASK_FREQUENCIES).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  recurringEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
};

function recurrenceFrom(
  input: { recurring: boolean; frequency?: string; weekday?: number; recurringEnd?: string; dueDate: string },
  timeZone: string,
) {
  if (!input.recurring) {
    return { recurring: false, frequency: null, weekday: null, recurringStart: null, recurringEnd: null };
  }
  if (!input.frequency) throw new UserError("Say how often it repeats.", "invalid", { frequency: ["Required"] });

  return {
    recurring: true,
    frequency: input.frequency,
    weekday: input.frequency === "Weekly" ? (input.weekday ?? new Date(`${input.dueDate}T00:00:00Z`).getUTCDay()) : null,
    recurringStart: dueDateFrom(input.dueDate, timeZone),
    recurringEnd: input.recurringEnd ? dueDateFrom(input.recurringEnd, timeZone) : null,
  };
}

export const createTask = defineAction({
  permission: "task:create",
  input: z.object(baseFields),
  async handler(ctx, input) {
    assertClientInScope(ctx.scope, input.clientId);

    const assignee = await ctx.db.user.findFirst({
      where: { id: input.assigneeId, status: "Active" },
      select: { id: true, name: true },
    });
    if (!assignee) throw new UserError("That person is not in this workspace.", "not_found");

    // A private task on somebody else would be invisible to them, which is a
    // task that will never be done.
    if (input.isPrivate && assignee.id !== ctx.user.id) {
      throw new UserError("A private task can only be on yourself.", "invalid");
    }

    const task = await ctx.db.task.create({
      data: {
        tenantId: ctx.user.tenantId,
        name: input.name,
        assigneeId: assignee.id,
        assignedById: ctx.user.id,
        clientId: input.clientId || null,
        brandId: input.brandId || null,
        relationshipId: input.relationshipId || null,
        priority: input.priority,
        category: input.category || null,
        status: "Not Started",
        dueDate: dueDateFrom(input.dueDate, ctx.user.timezone),
        estimatedMinutes: input.estimatedMinutes,
        notes: input.notes || null,
        docUrl: input.docUrl || null,
        isPrivate: input.isPrivate,
        ...recurrenceFrom(input, ctx.user.timezone),
      },
    });

    await ctx.db.taskStatusChange.create({
      data: { tenantId: ctx.user.tenantId, taskId: task.id, toStatus: "Not Started", actorId: ctx.user.id },
    });

    await ctx.audit({
      action: "created",
      resourceType: "Task",
      resourceId: task.id,
      resourceLabel: task.name,
      after: { assignee: assignee.name, dueDate: input.dueDate, estimatedMinutes: input.estimatedMinutes },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: [assignee.id],
      exceptUserId: ctx.user.id,
      event: "task.assigned",
      title: task.name,
      body: `Due ${input.dueDate} · from ${ctx.user.name}`,
      link: `/tasks/${task.id}`,
    });

    revalidatePath("/tasks");
    return { ok: true, data: { id: task.id }, message: `Assigned to ${assignee.name}.` } satisfies ActionResult<{ id: string }>;
  },
});

export const updateTask = defineAction({
  permission: "task:edit",
  input: z.object({ id: z.string().min(1), ...baseFields }),
  async handler(ctx, input) {
    const before = await getTask(ctx.scope, input.id);
    assertClientInScope(ctx.scope, input.clientId);

    // Somebody else's task is theirs unless you put it there or you run things.
    const mine = before.assigneeId === ctx.user.id || before.assignedById === ctx.user.id;
    if (!mine && !can(ctx.scope, "task:delete")) {
      throw new UserError("That is somebody else's task.", "denied");
    }

    const assignee = await ctx.db.user.findFirst({ where: { id: input.assigneeId, status: "Active" } });
    if (!assignee) throw new UserError("That person is not in this workspace.", "not_found");
    if (input.isPrivate && assignee.id !== ctx.user.id) {
      throw new UserError("A private task can only be on yourself.", "invalid");
    }

    const after = await ctx.db.task.update({
      where: { id: input.id },
      data: {
        name: input.name,
        assigneeId: assignee.id,
        clientId: input.clientId || null,
        brandId: input.brandId || null,
        relationshipId: input.relationshipId || null,
        priority: input.priority,
        category: input.category || null,
        dueDate: dueDateFrom(input.dueDate, ctx.user.timezone),
        estimatedMinutes: input.estimatedMinutes,
        notes: input.notes || null,
        docUrl: input.docUrl || null,
        isPrivate: input.isPrivate,
        ...recurrenceFrom(input, ctx.user.timezone),
      },
    });

    await ctx.audit({
      action: "updated",
      resourceType: "Task",
      resourceId: after.id,
      resourceLabel: after.name,
      before: {
        name: before.name,
        assigneeId: before.assigneeId,
        dueDate: before.dueDate.toISOString().slice(0, 10),
        priority: before.priority,
        estimatedMinutes: before.estimatedMinutes,
      },
      after: {
        name: after.name,
        assigneeId: after.assigneeId,
        dueDate: after.dueDate.toISOString().slice(0, 10),
        priority: after.priority,
        estimatedMinutes: after.estimatedMinutes,
      },
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

/**
 * Moving a task along, including completing it.
 *
 * Completion is the interesting one: it records lateness, asks for the actual
 * time, and creates the next occurrence — all in one transaction, so a crash
 * cannot leave a completed task whose successor never appeared.
 */
export const changeTaskStatus = defineAction({
  permission: "task:edit",
  input: z.object({
    id: z.string().min(1),
    status: z.enum(TASK_STATUSES),
    /** Required when completing. See the note at the top of this file. */
    actualMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
  }),
  async handler(ctx, input) {
    const task = await getTask(ctx.scope, input.id);

    if (task.status === input.status) return { ok: true } satisfies ActionResult;

    if (!allowedTransitions(task.status).includes(input.status)) {
      throw new UserError(`A ${task.status.toLowerCase()} task cannot go straight to ${input.status.toLowerCase()}.`, "invalid");
    }

    const completing = input.status === "Completed";
    if (completing && !input.actualMinutes) {
      throw new UserError("How long did it actually take?", "invalid", {
        actualMinutes: ["Required to complete a task"],
      });
    }

    const now = new Date();
    const timeZone = ctx.user.timezone;

    const result = await ctx.db.$transaction(async (tx) => {
      const daysLate = completing ? lateness(task.dueDate, now, timeZone) : null;

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: input.status,
          completedAt: completing ? now : null,
          daysLate: completing ? daysLate : null,
          actualMinutes: completing ? input.actualMinutes : task.actualMinutes,
          // Reopening clears the verification with it: a task that changed
          // after being verified is not a verified task.
          ...(task.status === "Completed" && !completing ? { verifiedById: null, verifiedAt: null } : {}),
        },
      });

      await tx.taskStatusChange.create({
        data: {
          tenantId: ctx.user.tenantId,
          taskId: task.id,
          fromStatus: task.status,
          toStatus: input.status,
          actorId: ctx.user.id,
        },
      });

      // ── the next occurrence
      let created: { id: string; dueDate: string } | null = null;

      if (completing && task.recurring && !task.nextCreated) {
        const nextDue = nextDueDate(task.dueDate, task, timeZone);

        if (nextDue) {
          const next = await tx.task.create({
            data: {
              tenantId: ctx.user.tenantId,
              name: task.name,
              assigneeId: task.assigneeId,
              assignedById: task.assignedById,
              clientId: task.clientId,
              brandId: task.brandId,
              relationshipId: task.relationshipId,
              priority: task.priority,
              category: task.category,
              status: "Not Started",
              dueDate: nextDue,
              estimatedMinutes: task.estimatedMinutes,
              notes: task.notes,
              docUrl: task.docUrl,
              isPrivate: task.isPrivate,
              recurring: true,
              frequency: task.frequency,
              weekday: task.weekday,
              recurringStart: task.recurringStart,
              recurringEnd: task.recurringEnd,
            },
          });

          await tx.taskStatusChange.create({
            data: { tenantId: ctx.user.tenantId, taskId: next.id, toStatus: "Not Started", actorId: ctx.user.id },
          });

          created = { id: next.id, dueDate: nextDue.toISOString().slice(0, 10) };
        }

        // Set whether or not a successor was created — a series that has
        // ended must not be asked again on every subsequent completion.
        await tx.task.update({ where: { id: task.id }, data: { nextCreated: true } });
      }

      return { daysLate, created };
    });

    await ctx.audit({
      action: completing ? "completed" : "status_changed",
      resourceType: "Task",
      resourceId: task.id,
      resourceLabel: task.name,
      before: { status: task.status },
      after: {
        status: input.status,
        ...(completing
          ? {
              daysLate: result.daysLate,
              actualMinutes: input.actualMinutes,
              estimatedMinutes: task.estimatedMinutes,
              nextOccurrence: result.created?.dueDate ?? null,
            }
          : {}),
      },
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);

    const late = result.daysLate ?? 0;
    return {
      ok: true,
      data: result.created,
      message: completing
        ? [
            late > 0 ? `Completed ${late} ${late === 1 ? "day" : "days"} late.` : "Completed on time.",
            result.created ? `Next one is due ${result.created.dueDate}.` : "",
          ]
            .filter(Boolean)
            .join(" ")
        : `Moved to ${input.status}.`,
    } satisfies ActionResult<{ id: string; dueDate: string } | null>;
  },
});

/**
 * Verification: a second pair of eyes.
 *
 * Refused for whoever completed the task, because the whole value of the step
 * is that somebody else looked. Allowing it makes it a checkbox that means
 * nothing, and a checkbox that means nothing is worse than no checkbox — it
 * reads as assurance on a report.
 */
export const verifyTask = defineAction({
  permission: "task:verify",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const task = await getTask(ctx.scope, input.id);

    if (task.status !== "Completed") throw new UserError("Only a completed task can be verified.");
    if (task.verifiedById) throw new UserError(`Already verified by ${task.verifiedBy?.name ?? "someone"}.`);

    // The person it was on did the work; the last status change says who
    // actually pressed complete. Either one disqualifies them.
    const completedBy = task.statusHistory.find((h) => h.toStatus === "Completed")?.actorId;
    if (completedBy === ctx.user.id || task.assigneeId === ctx.user.id) {
      throw new UserError("You completed this one. Verification is somebody else's job.", "denied");
    }

    await ctx.db.task.update({
      where: { id: task.id },
      data: { verifiedById: ctx.user.id, verifiedAt: new Date() },
    });

    await ctx.audit({
      action: "verified",
      resourceType: "Task",
      resourceId: task.id,
      resourceLabel: task.name,
      after: { verifiedBy: ctx.user.name, daysLate: task.daysLate },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: [task.assigneeId],
      exceptUserId: ctx.user.id,
      event: "task.verified",
      title: `${task.name} was verified`,
      body: `by ${ctx.user.name}`,
      link: `/tasks/${task.id}`,
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);
    return { ok: true, message: "Verified." } satisfies ActionResult;
  },
});

export const deleteTask = defineAction({
  permission: "task:delete",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const task = await getTask(ctx.scope, input.id);

    // Soft, like everything else: the history is the point of having it.
    await ctx.db.task.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

    await ctx.audit({
      action: "deleted",
      resourceType: "Task",
      resourceId: task.id,
      resourceLabel: task.name,
      before: { status: task.status, assigneeId: task.assigneeId },
    });

    revalidatePath("/tasks");
    return { ok: true, message: `${task.name} removed.` } satisfies ActionResult;
  },
});

/** Handing a task to somebody else, which is frequent enough to be one click. */
export const reassignTask = defineAction({
  permission: "task:edit",
  input: z.object({ id: z.string().min(1), assigneeId: z.string().min(1) }),
  async handler(ctx, input) {
    const task = await getTask(ctx.scope, input.id);
    const assignee = await ctx.db.user.findFirst({
      where: { id: input.assigneeId, status: "Active" },
      select: { id: true, name: true },
    });
    if (!assignee) throw new NotFoundError();

    if (task.isPrivate && assignee.id !== ctx.user.id) {
      throw new UserError("A private task cannot be handed to somebody else. Make it visible first.", "invalid");
    }

    await ctx.db.task.update({ where: { id: input.id }, data: { assigneeId: assignee.id } });

    await ctx.audit({
      action: "reassigned",
      resourceType: "Task",
      resourceId: task.id,
      resourceLabel: task.name,
      before: { assignee: task.assignee.name },
      after: { assignee: assignee.name },
    });

    await notify({
      tenantId: ctx.user.tenantId,
      userIds: [assignee.id],
      exceptUserId: ctx.user.id,
      event: "task.assigned",
      title: task.name,
      body: `Handed to you by ${ctx.user.name}`,
      link: `/tasks/${task.id}`,
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${input.id}`);
    return { ok: true, message: `Now on ${assignee.name}.` } satisfies ActionResult;
  },
});
