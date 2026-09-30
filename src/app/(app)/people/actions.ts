"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTIVITY_TYPES } from "@/lib/ui-enums";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { findPersonByEmail } from "@/lib/relationships";
import { NotFoundError } from "@/lib/scope";

/**
 * Writes for the Directory: the people this workspace knows.
 *
 * These lived in pipelines/actions.ts while people were reached through
 * pipelines. With the Pipelines screens removed they belong to the Directory,
 * and a note about a person is governed by `person:edit` — the permission for
 * the thing being written — rather than by the relationship permission it
 * borrowed before.
 */

const personFields = {
  name: z.string().trim().min(1, "A person needs a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
};

/** A call, a meeting, a message or a note about one person. */
export const logActivity = defineAction({
  permission: "person:edit",
  input: z.object({
    personId: z.string().min(1),
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1, "Say what happened").max(200),
    body: z.string().trim().max(4000).optional(),
    occurredAt: z.string().trim().optional(),
  }),
  async handler(ctx, input) {
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
      after: { type: input.type, subject: input.subject },
    });

    revalidatePath(`/people/${person.id}`);
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
