"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { NotFoundError } from "@/lib/scope";

/**
 * Merging two rows that are one human.
 *
 * The dedupe index stops this happening by email from now on, but it cannot
 * help with the two cases that actually produce duplicates: rows entered before
 * it existed, and the same person reached at a work address and a personal one.
 *
 * Two decisions worth stating.
 *
 * The merge runs on the raw tenant client rather than through the caller's
 * context scope, and it must: the duplicate may hold a relationship in a
 * pipeline this caller cannot see, and leaving that behind on a row that is
 * about to be soft-deleted would strand it. What the caller is *shown* stays
 * scoped — `mergePreview` counts what it cannot name — but the write moves
 * everything.
 *
 * And a collision is refused, not resolved. If both rows hold a relationship in
 * the same pipeline, one of them has history the other does not, and picking
 * for them would quietly discard a stage sequence somebody may need. The
 * refusal names the pipeline so they can settle it first.
 */

/** What a merge would move, for the confirmation screen. */
export const mergePreview = defineAction({
  permission: "person:edit",
  input: z.object({ keepId: z.string().min(1), mergeId: z.string().min(1) }),
  async handler(ctx, input) {
    if (input.keepId === input.mergeId) throw new UserError("Those are the same person.", "invalid");

    const [keep, merge] = await Promise.all([
      ctx.db.person.findFirst({ where: { id: input.keepId, deletedAt: null } }),
      ctx.db.person.findFirst({ where: { id: input.mergeId, deletedAt: null } }),
    ]);
    if (!keep || !merge) throw new NotFoundError();

    const [keepRels, mergeRels, activities, contacts] = await Promise.all([
      ctx.db.relationship.findMany({
        where: { personId: keep.id, deletedAt: null },
        select: { contextId: true, context: { select: { name: true } } },
      }),
      ctx.db.relationship.findMany({
        where: { personId: merge.id, deletedAt: null },
        select: { contextId: true, context: { select: { name: true } } },
      }),
      ctx.db.activity.count({ where: { personId: merge.id } }),
      ctx.db.clientContact.count({ where: { personId: merge.id } }),
    ]);

    const keepContexts = new Set(keepRels.map((r) => r.contextId));
    const collisions = mergeRels.filter((r) => keepContexts.has(r.contextId)).map((r) => r.context.name);

    return {
      ok: true,
      data: {
        keepName: keep.name,
        mergeName: merge.name,
        relationships: mergeRels.length,
        activities,
        contacts,
        collisions,
      },
    } satisfies ActionResult<{
      keepName: string;
      mergeName: string;
      relationships: number;
      activities: number;
      contacts: number;
      collisions: string[];
    }>;
  },
});

export const mergePeople = defineAction({
  permission: "person:edit",
  input: z.object({
    keepId: z.string().min(1),
    mergeId: z.string().min(1),
    /** Fields to take from the row being merged away, where the kept one is blank. */
    adoptEmail: z.boolean().default(false),
    adoptPhone: z.boolean().default(false),
  }),
  async handler(ctx, input) {
    if (input.keepId === input.mergeId) throw new UserError("Those are the same person.", "invalid");

    const [keep, merge] = await Promise.all([
      ctx.db.person.findFirst({ where: { id: input.keepId, deletedAt: null } }),
      ctx.db.person.findFirst({ where: { id: input.mergeId, deletedAt: null } }),
    ]);
    if (!keep || !merge) throw new NotFoundError();

    const [keepRels, mergeRels] = await Promise.all([
      ctx.db.relationship.findMany({
        where: { personId: keep.id, deletedAt: null },
        select: { contextId: true, context: { select: { name: true } } },
      }),
      ctx.db.relationship.findMany({
        where: { personId: merge.id, deletedAt: null },
        select: { id: true, contextId: true, context: { select: { name: true } } },
      }),
    ]);

    const keepContexts = new Set(keepRels.map((r) => r.contextId));
    const collisions = mergeRels.filter((r) => keepContexts.has(r.contextId)).map((r) => r.context.name);

    if (collisions.length) {
      throw new UserError(
        `Both hold a ${collisions.join(" and ")} relationship. One of them has history the other does not, and merging would discard it — close or delete the one you do not want first.`,
      );
    }

    const moved = await ctx.db.$transaction(async (tx) => {
      const relationships = await tx.relationship.updateMany({
        where: { personId: merge.id },
        data: { personId: keep.id },
      });
      const activities = await tx.activity.updateMany({ where: { personId: merge.id }, data: { personId: keep.id } });

      // A contact link is keyed on (clientId, personId), so one that would
      // collide is dropped rather than moved — the kept person is already
      // a contact at that client.
      const links = await tx.clientContact.findMany({ where: { personId: merge.id }, select: { clientId: true } });
      const existing = await tx.clientContact.findMany({
        where: { personId: keep.id, clientId: { in: links.map((l) => l.clientId) } },
        select: { clientId: true },
      });
      const taken = new Set(existing.map((e) => e.clientId));

      for (const link of links) {
        if (taken.has(link.clientId)) {
          await tx.clientContact.delete({ where: { clientId_personId: { clientId: link.clientId, personId: merge.id } } });
        } else {
          await tx.clientContact.update({
            where: { clientId_personId: { clientId: link.clientId, personId: merge.id } },
            data: { personId: keep.id },
          });
        }
      }

      // The email has to leave the merged row before the kept one can take it:
      // the unique index sees both while both are live.
      await tx.person.update({
        where: { id: merge.id },
        data: { email: null, deletedAt: new Date(), notes: mergedNote(merge.notes, keep.name) },
      });

      await tx.person.update({
        where: { id: keep.id },
        data: {
          email: input.adoptEmail && !keep.email ? merge.email : keep.email,
          phone: input.adoptPhone && !keep.phone ? merge.phone : keep.phone,
          notes: [keep.notes, merge.notes].filter(Boolean).join("\n\n") || null,
        },
      });

      return { relationships: relationships.count, activities: activities.count, contacts: links.length };
    });

    await ctx.audit({
      action: "merged",
      resourceType: "Person",
      resourceId: keep.id,
      resourceLabel: keep.name,
      before: { mergedId: merge.id, mergedName: merge.name, mergedEmail: merge.email },
      after: { ...moved, keptName: keep.name },
    });

    revalidatePath("/people");
    revalidatePath(`/people/${input.keepId}`);

    return {
      ok: true,
      data: { id: keep.id },
      message: `${merge.name} merged into ${keep.name}: ${moved.relationships} ${moved.relationships === 1 ? "relationship" : "relationships"}, ${moved.activities} logged ${moved.activities === 1 ? "item" : "items"}.`,
    } satisfies ActionResult<{ id: string }>;
  },
});

/** Leaves a trace on the row that was merged away, for anyone who finds it. */
function mergedNote(existing: string | null, keptName: string): string {
  const stamp = `Merged into ${keptName} on ${new Date().toISOString().slice(0, 10)}.`;
  return existing ? `${existing}\n\n${stamp}` : stamp;
}
