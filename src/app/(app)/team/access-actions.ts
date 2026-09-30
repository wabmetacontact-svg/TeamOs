"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { NotFoundError } from "@/lib/scope";

/**
 * Setting which clients one person can reach.
 *
 * Client scope can also be granted from a client's own page, which is the
 * natural place when you are looking at the client. This is the other
 * direction: you are looking at the person and deciding what they should be
 * able to reach. Same rows, same effect.
 *
 * Pipeline scope used to be set here too. The Pipelines screens are gone, so
 * that axis is no longer offered, and whatever a person already had is left
 * exactly as it was rather than silently widened or cleared.
 *
 * Nothing here touches a session. Scope is read from the database on every
 * request, so a change is in force the moment that person loads their next
 * page — no sign-out, no waiting for a token to expire.
 */
export const setUserAccess = defineAction({
  permission: "user:edit",
  input: z.object({
    userId: z.string().min(1),
    allClients: z.boolean(),
    clientIds: z.array(z.string()).max(500).default([]),
  }),
  async handler(ctx, input) {
    const target = await ctx.db.user.findUnique({
      where: { id: input.userId },
      include: {
        role: { select: { name: true } },
        scope: { select: { clientId: true } },
      },
    });
    if (!target) throw new NotFoundError();

    // Narrowing an Owner's reach leaves nobody able to widen it again.
    if (target.role.name === "Owner" && !input.allClients) {
      throw new UserError("An Owner sees everything. Change their role first if that is the intent.");
    }

    // Only ids that exist — a stale id from a form open in another tab would
    // otherwise become a grant to nothing, invisible in the list.
    const clients = input.allClients
      ? []
      : await ctx.db.client.findMany({ where: { id: { in: input.clientIds }, deletedAt: null }, select: { id: true } });

    if (!input.allClients && clients.length === 0) {
      throw new UserError(
        `${target.name} would be able to reach no clients at all. Give them at least one, or deactivate the account instead.`,
        "invalid",
      );
    }

    await ctx.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { allClients: input.allClients },
      });

      // Replace rather than diff: the form sends the whole intended set, and
      // a diff would need the same replace to be correct anyway.
      await tx.userClientScope.deleteMany({ where: { userId: target.id } });
      if (!input.allClients && clients.length) {
        await tx.userClientScope.createMany({
          data: clients.map((c) => ({ tenantId: ctx.user.tenantId, userId: target.id, clientId: c.id })),
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
      },
      after: {
        allClients: input.allClients,
        clients: input.allClients ? "all" : clients.length,
      },
    });

    revalidatePath("/team");

    return {
      ok: true,
      message: `${target.name} now reaches ${
        input.allClients ? "every client" : `${clients.length} ${clients.length === 1 ? "client" : "clients"}`
      }.`,
    } satisfies ActionResult;
  },
});
