"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { toActionError, UserError, type ActionResult } from "@/lib/action";
import { hashToken, lookupInvite } from "@/lib/invitations";

/**
 * Accepting an invitation is the one write in this application that runs
 * without a session, so it does not go through defineAction — there is nobody
 * to check a permission against. The token is the authorisation, and it is
 * re-validated here rather than trusted from the page that rendered the form:
 * the page ran at some earlier moment, and an invite can be revoked in between.
 */

const schema = z
  .object({
    token: z.string().min(16),
    name: z.string().trim().min(1, "Enter your name").max(120),
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match" });

export async function acceptInvitation(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let accepted: { userId: string; tenantId: string } | null = null;

  try {
    const input = schema.parse(Object.fromEntries(formData));

    const { state, invite } = await lookupInvite(input.token);
    if (state !== "valid" || !invite) {
      throw new UserError(
        state === "expired"
          ? "This invitation has expired. Ask for a new one."
          : state === "accepted"
            ? "This invitation has already been used. Try signing in."
            : "This invitation link is not valid.",
        "denied",
      );
    }

    const passwordHash = await hashPassword(input.password);
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    accepted = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${invite.tenantId}, TRUE)`;

      // Re-read and stamp in the same transaction. updateMany with the
      // acceptedAt: null guard means a second request that got this far
      // concurrently updates zero rows and is turned away below, so the link
      // creates exactly one account even under a double submit.
      const claimed = await tx.invitation.updateMany({
        where: { tokenHash: hashToken(input.token), acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new UserError("This invitation has already been used.", "denied");

      const user = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          name: input.name,
          passwordHash,
          roleId: invite.roleId,
          allClients: invite.allClients,
          lastLoginAt: new Date(),
        },
      });

      if (!invite.allClients && invite.clientIds.length) {
        // The clients may have been archived or deleted since the invite was
        // sent, so grant only the ones that are still there.
        const live = await tx.client.findMany({ where: { id: { in: invite.clientIds } }, select: { id: true } });
        if (live.length) {
          await tx.userClientScope.createMany({
            data: live.map((c) => ({ tenantId: invite.tenantId, userId: user.id, clientId: c.id })),
          });
        }
      }

      await tx.auditEntry.create({
        data: {
          tenantId: invite.tenantId,
          actorId: user.id,
          action: "invitation_accepted",
          resourceType: "User",
          resourceId: user.id,
          resourceLabel: user.email,
          after: { role: invite.roleName, invitedBy: invite.invitedByName },
          ip,
        },
      });

      return { userId: user.id, tenantId: invite.tenantId };
    });
  } catch (err) {
    return toActionError(err);
  }

  // Outside the try: startSession sets a cookie and redirect() throws, neither
  // of which should be caught and reported as a failure.
  await startSession(accepted.userId, accepted.tenantId);
  redirect("/dashboard");
}
