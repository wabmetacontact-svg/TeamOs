"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTIVITY_TYPES } from "@/lib/ui-enums";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { findPersonByEmail, getRelationship } from "@/lib/relationships";
import { assertContextInScope, NotFoundError } from "@/lib/scope";


const personFields = {
  name: z.string().trim().min(1, "A person needs a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
};

/**
 * Starting a relationship.
 *
 * The person comes first and may already exist — that is the normal case, not
 * the exception, because the whole point of one person table is that an
 * investor who later becomes a KOL is the same row. So an email that is
 * already on file resolves to that person rather than creating a second.
 */
export const createRelationship = defineAction({
  permission: "relationship:create",
  input: z.object({
    ...personFields,
    /** Supplied when starting from an existing person; otherwise they are matched or created. */
    personId: z.string().optional(),
    contextId: z.string().min(1, "Choose a pipeline"),
    stageId: z.string().optional(),
    ownerId: z.string().optional(),
    clientId: z.string().optional(),
    value: z.string().trim().optional(),
    currency: z.string().trim().length(3).toUpperCase().default("INR"),
    relationshipNotes: z.string().trim().max(2000).optional(),
  }),
  async handler(ctx, input) {
    // A pipeline you cannot see is a pipeline you cannot file into.
    assertContextInScope(ctx.scope, input.contextId);

    const context = await ctx.db.context.findUnique({
      where: { id: input.contextId },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!context) throw new NotFoundError();

    let person = input.personId
      ? await ctx.db.person.findFirst({ where: { id: input.personId, deletedAt: null } })
      : input.email
        ? await findPersonByEmail(ctx.scope, input.email)
        : null;

    const reusedExisting = Boolean(person);

    if (!person) {
      person = await ctx.db.person.create({
        data: {
          tenantId: ctx.user.tenantId,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          notes: input.notes || null,
        },
      });
    }

    // The unique index on (personId, contextId) would catch this, but the
    // message it produces is not one anybody can act on.
    const existing = await ctx.db.relationship.findFirst({
      where: { personId: person.id, contextId: input.contextId, deletedAt: null },
    });
    if (existing) {
      throw new UserError(
        `${person.name} already has a ${context.name} relationship. One person holds one relationship per pipeline — open that one instead.`,
      );
    }

    const stageId = input.stageId || context.stages[0]?.id || null;
    if (stageId && !context.stages.some((s) => s.id === stageId)) {
      throw new UserError(`That stage does not belong to ${context.name}.`, "invalid");
    }

    const relationship = await ctx.db.relationship.create({
      data: {
        tenantId: ctx.user.tenantId,
        personId: person.id,
        contextId: input.contextId,
        stageId,
        ownerId: input.ownerId || ctx.user.id,
        clientId: input.clientId || null,
        value: parseMoney(input.value),
        currency: input.currency,
        notes: input.relationshipNotes || null,
      },
    });

    // The opening move is a stage change from nothing, so the history reads as
    // one sequence rather than starting mid-stream.
    if (stageId) {
      await ctx.db.relationshipStageChange.create({
        data: {
          tenantId: ctx.user.tenantId,
          relationshipId: relationship.id,
          fromStageId: null,
          toStageId: stageId,
          actorId: ctx.user.id,
        },
      });
    }

    await ctx.audit({
      action: "created",
      resourceType: "Relationship",
      resourceId: relationship.id,
      resourceLabel: `${person.name} · ${context.name}`,
      after: { person: person.name, context: context.name, reusedExisting },
    });

    revalidatePath("/pipelines");
    revalidatePath("/people");

    return {
      ok: true,
      data: { id: relationship.id, personId: person.id },
      message: reusedExisting
        ? `${person.name} was already on file — this is their ${context.name} relationship.`
        : `${person.name} added to ${context.name}.`,
    } satisfies ActionResult<{ id: string; personId: string }>;
  },
});

/**
 * Moving a stage, which is the one edit that always leaves a trace. A pipeline
 * whose history you cannot reconstruct is a pipeline nobody trusts when the
 * numbers are questioned.
 */
export const moveStage = defineAction({
  permission: "relationship:edit",
  input: z.object({ id: z.string().min(1), stageId: z.string().min(1), note: z.string().trim().max(300).optional() }),
  async handler(ctx, input) {
    const relationship = await getRelationship(ctx.scope, input.id);

    const stage = await ctx.db.pipelineStage.findFirst({
      where: { id: input.stageId, contextId: relationship.contextId },
    });
    if (!stage) throw new UserError(`That stage does not belong to ${relationship.context.name}.`, "invalid");
    if (stage.id === relationship.stageId) return { ok: true } satisfies ActionResult;

    await ctx.db.relationship.update({ where: { id: input.id }, data: { stageId: stage.id } });
    await ctx.db.relationshipStageChange.create({
      data: {
        tenantId: ctx.user.tenantId,
        relationshipId: relationship.id,
        fromStageId: relationship.stageId,
        toStageId: stage.id,
        actorId: ctx.user.id,
        note: input.note || null,
      },
    });

    await ctx.audit({
      action: "stage_changed",
      resourceType: "Relationship",
      resourceId: relationship.id,
      resourceLabel: `${relationship.person.name} · ${relationship.context.name}`,
      before: { stage: relationship.stage?.name ?? null },
      after: { stage: stage.name, note: input.note || null },
    });

    revalidatePath("/pipelines");
    revalidatePath(`/relationships/${input.id}`);
    return { ok: true, message: `Moved to ${stage.name}.` } satisfies ActionResult;
  },
});

export const updateRelationship = defineAction({
  permission: "relationship:edit",
  input: z.object({
    id: z.string().min(1),
    ownerId: z.string().optional(),
    clientId: z.string().optional(),
    value: z.string().trim().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  async handler(ctx, input) {
    const before = await getRelationship(ctx.scope, input.id);

    const after = await ctx.db.relationship.update({
      where: { id: input.id },
      data: {
        ownerId: input.ownerId || null,
        clientId: input.clientId || null,
        value: parseMoney(input.value),
        currency: input.currency ?? before.currency,
        notes: input.notes || null,
      },
    });

    await ctx.audit({
      action: "updated",
      resourceType: "Relationship",
      resourceId: after.id,
      resourceLabel: `${before.person.name} · ${before.context.name}`,
      before: { ownerId: before.ownerId, value: before.value?.toString() ?? null, notes: before.notes },
      after: { ownerId: after.ownerId, value: after.value?.toString() ?? null, notes: after.notes },
    });

    revalidatePath("/pipelines");
    revalidatePath(`/relationships/${input.id}`);
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

/**
 * Logging what happened.
 *
 * An activity tied to a relationship inherits that relationship's visibility —
 * which is what keeps an investor conversation out of a KOL manager's view
 * without a second set of rules. One left untied is a plain note about the
 * person and is readable by anyone who can see the person.
 */
export const logActivity = defineAction({
  permission: "relationship:edit",
  input: z.object({
    personId: z.string().min(1),
    relationshipId: z.string().optional(),
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1, "Say what happened").max(200),
    body: z.string().trim().max(4000).optional(),
    occurredAt: z.string().trim().optional(),
  }),
  async handler(ctx, input) {
    if (input.relationshipId) {
      // Through getRelationship, so an out-of-scope pipeline cannot be written
      // into any more than it can be read from.
      await getRelationship(ctx.scope, input.relationshipId);
    }

    const person = await ctx.db.person.findFirst({ where: { id: input.personId, deletedAt: null } });
    if (!person) throw new NotFoundError();

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new UserError("That date did not parse.", "invalid");
    if (occurredAt.getTime() > Date.now() + 86_400_000) {
      throw new UserError("That is in the future. Log it after it happens.", "invalid");
    }

    const activity = await ctx.db.activity.create({
      data: {
        tenantId: ctx.user.tenantId,
        personId: person.id,
        relationshipId: input.relationshipId || null,
        type: input.type,
        subject: input.subject,
        body: input.body || null,
        occurredAt,
        actorId: ctx.user.id,
      },
    });

    await ctx.audit({
      action: "activity_logged",
      resourceType: "Person",
      resourceId: person.id,
      resourceLabel: person.name,
      after: { type: input.type, subject: input.subject, relationshipId: input.relationshipId ?? null },
    });

    revalidatePath(`/people/${person.id}`);
    if (input.relationshipId) revalidatePath(`/relationships/${input.relationshipId}`);
    return { ok: true, data: { id: activity.id }, message: "Logged." } satisfies ActionResult<{ id: string }>;
  },
});

export const updatePerson = defineAction({
  permission: "person:edit",
  input: z.object({ id: z.string().min(1), ...personFields }),
  async handler(ctx, input) {
    const before = await ctx.db.person.findFirst({ where: { id: input.id, deletedAt: null } });
    if (!before) throw new NotFoundError();

    if (input.email && input.email !== before.email) {
      const clash = await findPersonByEmail(ctx.scope, input.email);
      if (clash && clash.id !== before.id) {
        throw new UserError(`${clash.name} already uses that address. One row per human is the point.`);
      }
    }

    const after = await ctx.db.person.update({
      where: { id: input.id },
      data: { name: input.name, email: input.email || null, phone: input.phone || null, notes: input.notes || null },
    });

    await ctx.audit({
      action: "updated",
      resourceType: "Person",
      resourceId: after.id,
      resourceLabel: after.name,
      before: { name: before.name, email: before.email, phone: before.phone },
      after: { name: after.name, email: after.email, phone: after.phone },
    });

    revalidatePath("/people");
    revalidatePath(`/people/${input.id}`);
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

/** Cheque sizes arrive as "50,00,000" or "5000000" and are stored in minor units. */
function parseMoney(input: string | undefined): bigint | null {
  const cleaned = input?.replace(/[,\s₹$]/g, "").trim();
  if (!cleaned) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 100));
}
