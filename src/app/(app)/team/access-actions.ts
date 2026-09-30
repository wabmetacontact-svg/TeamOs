"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { NotFoundError } from "@/lib/scope";

/**
 * Setting one person's reach, on both axes at once.
 *
 * Client scope can also be granted from a client's own page, which is the
 * natural place when you are looking at the client. This is the other
 * direction: you are looking at the person and deciding what they should be
 * able to reach. Same rows, same effect.
 *
 * Neither axis touches a session. Scope is read from the database on every
 * request, so a change here is in force the moment that person loads their
 * next page — no sign-out, no waiting for a token to expire.
 */
export const setUserAccess = defineAction({
  permission: "user:edit",
  input: z.object({
    userId: z.string().min(1),
    allClients: z.boolean(),
    clientIds: z.array(z.string()).max(500).default([]),
    allContexts: z.boolean(),
    contextIds: z.array(z.string()).max(100).default([]),
  }),
  async handler(ctx, input) {
    const target = await ctx.db.user.findUnique({
      where: { id: input.userId },
      include: {
        role: { select: { name: true } },
        scope: { select: { clientId: true } },
        contextScope: { select: { contextId: true } },
      },
    });
    if (!target) throw new NotFoundError();

    // Narrowing an Owner's reach leaves nobody able to widen it again.
    if (target.role.name === "Owner" && (!input.allClients || !input.allContexts)) {
      throw new UserError("An Owner sees everything. Change their role first if that is the intent.");
    }

    // Only ids that exist — a stale id from a form open in another tab would
    // otherwise become a grant to nothing, invisible in the list.
    const [clients, contexts] = await Promise.all([
      input.allClients
        ? Promise.resolve([])
        : ctx.db.client.findMany({ where: { id: { in: input.clientIds }, deletedAt: null }, select: { id: true } }),
      input.allContexts
        ? Promise.resolve([])
        : ctx.db.context.findMany({ where: { id: { in: input.contextIds } }, select: { id: true } }),
    ]);

    if (!input.allClients && clients.length === 0 && !input.allContexts && contexts.length === 0) {
      throw new UserError(
        `${target.name} would be able to reach nothing at all. Give them at least one client or pipeline, or deactivate the account instead.`,
      );
    }

    await ctx.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { allClients: input.allClients, allContexts: input.allContexts },
      });

      // Replace rather than diff: the form sends the whole intended set, and
      // a diff would need the same replace to be correct anyway.
      await tx.userClientScope.deleteMany({ where: { userId: target.id } });
      if (!input.allClients && clients.length) {
        await tx.userClientScope.createMany({
          data: clients.map((c) => ({ tenantId: ctx.user.tenantId, userId: target.id, clientId: c.id })),
        });
      }

      await tx.userContextScope.deleteMany({ where: { userId: target.id } });
      if (!input.allContexts && contexts.length) {
        await tx.userContextScope.createMany({
          data: contexts.map((c) => ({ tenantId: ctx.user.tenantId, userId: target.id, contextId: c.id })),
        });
      }
    });

    await ctx.audit({
      action: "access_changed",
      resourceType: "User",
      resourceId: target.id,
      resourceLabel: target.email,
      before: {
        allClients: target.allClients,
        clients: target.scope.length,
        allContexts: target.allContexts,
        contexts: target.contextScope.length,
      },
      after: {
        allClients: input.allClients,
        clients: input.allClients ? "all" : clients.length,
        allContexts: input.allContexts,
        contexts: input.allContexts ? "all" : contexts.length,
      },
    });

    revalidatePath("/team");

    const describe = (all: boolean, n: number, one: string, many: string) =>
      all ? `every ${one}` : `${n} ${n === 1 ? one : many}`;

    return {
      ok: true,
      message: `${target.name} now reaches ${describe(input.allClients, clients.length, "client", "clients")} and ${describe(input.allContexts, contexts.length, "pipeline", "pipelines")}.`,
    } satisfies ActionResult;
  },
});
