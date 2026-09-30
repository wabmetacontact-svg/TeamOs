"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { assertContextInScope, NotFoundError } from "@/lib/scope";

/**
 * Pipeline configuration.
 *
 * A context is a pipeline — Investor, KOL, Partner — and its stages are the
 * columns on the board. Both were seed data until now, which meant adding a
 * pipeline required a developer.
 *
 * These sit behind settings permissions rather than relationship ones, for the
 * same reason brands do: someone who works a pipeline should not be able to
 * redefine it underneath everyone else working it.
 */

const nameField = z.string().trim().min(1, "Needs a name").max(60);

export const createContext = defineAction({
  permission: "settings:edit",
  input: z.object({
    name: nameField,
    /** Sensible columns so a new pipeline is usable immediately rather than empty. */
    stages: z.array(z.string().trim().min(1)).max(20).default(["New", "In conversation", "Won", "Lost"]),
  }),
  async handler(ctx, input) {
    if (await ctx.db.context.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
      throw new UserError(`${input.name} already exists.`);
    }

    const last = await ctx.db.context.findFirst({ orderBy: { position: "desc" }, select: { position: true } });

    const context = await ctx.db.context.create({
      data: {
        tenantId: ctx.user.tenantId,
        name: input.name,
        position: (last?.position ?? -1) + 1,
      },
    });

    // The last two default stages are terminal: a pipeline with no way to end
    // accumulates forever and nobody ever closes anything.
    await ctx.db.pipelineStage.createMany({
      data: input.stages.map((name, i) => ({
        tenantId: ctx.user.tenantId,
        contextId: context.id,
        name,
        position: i,
        isTerminal: /^(won|lost|signed|closed|declined|passed)$/i.test(name),
      })),
    });

    await ctx.audit({
      action: "created",
      resourceType: "Context",
      resourceId: context.id,
      resourceLabel: context.name,
      after: { name: context.name, stages: input.stages },
    });

    revalidatePath("/pipelines");
    revalidatePath("/pipelines/manage");
    return { ok: true, data: { id: context.id }, message: `${context.name} added.` } satisfies ActionResult<{ id: string }>;
  },
});

export const renameContext = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1), name: nameField }),
  async handler(ctx, input) {
    const context = await ctx.db.context.findUnique({ where: { id: input.id } });
    if (!context) throw new NotFoundError();

    const clash = await ctx.db.context.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, id: { not: input.id } },
    });
    if (clash) throw new UserError(`${input.name} already exists.`);

    if (context.name === input.name) return { ok: true } satisfies ActionResult;

    await ctx.db.context.update({ where: { id: input.id }, data: { name: input.name } });
    await ctx.audit({
      action: "updated",
      resourceType: "Context",
      resourceId: context.id,
      resourceLabel: input.name,
      before: { name: context.name },
      after: { name: input.name },
    });

    revalidatePath("/pipelines");
    revalidatePath("/pipelines/manage");
    return { ok: true, message: "Renamed." } satisfies ActionResult;
  },
});

const stageInput = z.object({
  /** Absent for a stage being added in this save. */
  id: z.string().optional(),
  name: nameField,
  isTerminal: z.boolean().default(false),
});

/**
 * Saves a pipeline's whole stage list at once — added, renamed, reordered and
 * removed together, because that is how people actually edit a board.
 *
 * Removing a stage that relationships sit on is refused rather than cascading.
 * The alternative is moving them somewhere nobody chose, and a relationship
 * that silently changed stage is a relationship whose history now lies.
 */
export const updateContextStages = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1), stages: z.array(stageInput).min(1, "A pipeline needs at least one stage").max(20) }),
  async handler(ctx, input) {
    const context = await ctx.db.context.findUnique({
      where: { id: input.id },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!context) throw new NotFoundError();

    const names = input.stages.map((s) => s.name.toLowerCase());
    const duplicate = names.find((n, i) => names.indexOf(n) !== i);
    if (duplicate) throw new UserError(`Two stages are both called "${duplicate}".`, "invalid");

    const keptIds = new Set(input.stages.map((s) => s.id).filter(Boolean) as string[]);
    const removed = context.stages.filter((s) => !keptIds.has(s.id));

    if (removed.length) {
      const counts = await ctx.db.relationship.groupBy({
        by: ["stageId"],
        where: { stageId: { in: removed.map((s) => s.id) }, deletedAt: null },
        _count: { _all: true },
      });

      const blocking = counts
        .filter((c) => c._count._all > 0)
        .map((c) => {
          const stage = removed.find((s) => s.id === c.stageId)!;
          return `${stage.name} (${c._count._all})`;
        });

      if (blocking.length) {
        throw new UserError(
          `Move what is on ${blocking.join(" and ")} first. Deleting a stage underneath a relationship would change its stage without anyone choosing to.`,
        );
      }
    }

    await ctx.db.$transaction(async (tx) => {
      for (const [position, stage] of input.stages.entries()) {
        if (stage.id) {
          await tx.pipelineStage.update({
            where: { id: stage.id },
            data: { name: stage.name, isTerminal: stage.isTerminal, position },
          });
        } else {
          await tx.pipelineStage.create({
            data: {
              tenantId: ctx.user.tenantId,
              contextId: context.id,
              name: stage.name,
              isTerminal: stage.isTerminal,
              position,
            },
          });
        }
      }
      if (removed.length) {
        await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
      }
    });

    await ctx.audit({
      action: "stages_updated",
      resourceType: "Context",
      resourceId: context.id,
      resourceLabel: context.name,
      before: { stages: context.stages.map((s) => s.name) },
      after: { stages: input.stages.map((s) => s.name), removed: removed.map((s) => s.name) },
    });

    revalidatePath("/pipelines");
    revalidatePath("/pipelines/manage");
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

export const deleteContext = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1), confirmName: z.string().trim().min(1) }),
  async handler(ctx, input) {
    assertContextInScope(ctx.scope, input.id);

    const context = await ctx.db.context.findUnique({ where: { id: input.id } });
    if (!context) throw new NotFoundError();

    if (input.confirmName.toLowerCase() !== context.name.toLowerCase()) {
      throw new UserError("The name does not match. Type it exactly to confirm.");
    }

    const relationships = await ctx.db.relationship.count({ where: { contextId: input.id, deletedAt: null } });
    if (relationships > 0) {
      throw new UserError(
        `${context.name} still holds ${relationships} ${relationships === 1 ? "relationship" : "relationships"}. Deleting it would take every conversation in it.`,
      );
    }

    await ctx.db.context.delete({ where: { id: input.id } });
    await ctx.audit({
      action: "deleted",
      resourceType: "Context",
      resourceId: context.id,
      resourceLabel: context.name,
      before: { name: context.name },
    });

    revalidatePath("/pipelines");
    revalidatePath("/pipelines/manage");
    return { ok: true, message: `${context.name} deleted.` } satisfies ActionResult;
  },
});
