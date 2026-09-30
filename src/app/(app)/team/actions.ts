"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { revokeAllSessions } from "@/lib/auth";
import { INVITE_TTL_HOURS, inviteUrl, newInviteToken } from "@/lib/invitations";
import { permissionOverrides, PROTECTED_ROLE } from "@/lib/permissions";

const emailField = z.string().trim().toLowerCase().email("Enter a valid email");

/**
 * Sending an invitation.
 *
 * The plaintext token is returned to the caller once, here, and never stored.
 * Until mail is wired up the inviter copies the link themselves; when it is,
 * this is the only place that has to change.
 */
export const inviteUser = defineAction({
  permission: "user:invite",
  input: z.object({
    email: emailField,
    name: z.string().trim().max(120).optional(),
    roleId: z.string().min(1, "Choose a role"),
    allClients: z.boolean().default(false),
    clientIds: z.array(z.string()).max(500).default([]),
    /**
     * The features they get, as ticked. Absent means "exactly the role". Only
     * the difference from the role is stored.
     */
    permissions: z.array(z.string()).max(200).optional(),
  }),
  async handler(ctx, input) {
    const role = await ctx.db.role.findUnique({
      where: { id: input.roleId },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw new UserError("That role no longer exists.", "not_found");

    // Handing out a role you do not hold yourself is how privilege escalates.
    if (role.name === "Owner" && ctx.scope.roleName !== "Owner") {
      throw new UserError("Only an Owner can invite another Owner.", "denied");
    }

    // The same reasoning for clients: an inviter cannot grant reach they do
    // not have. "Every client" from someone scoped to two would be a way to
    // widen their own team past their own view.
    if (input.allClients && !ctx.scope.allClients) {
      throw new UserError("You can only give access to the clients you can see yourself.", "denied");
    }

    if (!input.allClients) {
      if (input.clientIds.length === 0) {
        throw new UserError("Pick at least one client, or give access to every client.", "invalid", {
          clientIds: ["Choose at least one"],
        });
      }

      // Checked against the database rather than trusted from the form: an id
      // that no longer exists, or belongs to a client outside the inviter's
      // scope, would otherwise become a grant on acceptance.
      const reachable = await ctx.db.client.findMany({
        where: {
          id: { in: input.clientIds },
          deletedAt: null,
          ...(ctx.scope.allClients ? {} : { AND: [{ id: { in: [...ctx.scope.clientIds] } }] }),
        },
        select: { id: true },
      });
      if (reachable.length !== new Set(input.clientIds).size) {
        throw new UserError("One of those clients is no longer available. Refresh and choose again.", "conflict");
      }
    }

    // What they can do, beyond or short of the role. Nobody can hand out a
    // feature they do not have themselves — that would let anyone who can
    // invite create an account more powerful than their own.
    const overrides = input.permissions
      ? permissionOverrides({
          roleName: role.name,
          roleKeys: role.permissions.map((rp) => rp.permission.key),
          chosen: input.permissions,
          granterKeys: ctx.scope.permissions,
        })
      : { granted: [], revoked: [], escalations: [], unknown: [] };

    if (overrides.unknown.length) {
      throw new UserError("One of those features is not recognised. Refresh and choose again.", "invalid");
    }
    if (overrides.escalations.length) {
      throw new UserError(
        `You cannot give access you do not have yourself (${overrides.escalations.join(", ")}).`,
        "denied",
      );
    }

    if (await ctx.db.user.findFirst({ where: { email: input.email } })) {
      throw new UserError("Someone with that email is already in this workspace.");
    }

    // Re-inviting replaces the outstanding invite rather than stacking a second
    // live link beside it — two valid links to one seat is one too many.
    await ctx.db.invitation.deleteMany({ where: { email: input.email, acceptedAt: null } });

    const { token, tokenHash } = newInviteToken();
    const invitation = await ctx.db.invitation.create({
      data: {
        tenantId: ctx.user.tenantId,
        email: input.email,
        name: input.name || null,
        roleId: role.id,
        allClients: input.allClients,
        clientIds: input.allClients ? [] : input.clientIds,
        permissionsGranted: overrides.granted,
        permissionsRevoked: overrides.revoked,
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      },
    });

    await ctx.audit({
      action: "invited",
      resourceType: "Invitation",
      resourceId: invitation.id,
      resourceLabel: input.email,
      after: {
        email: input.email,
        role: role.name,
        allClients: input.allClients,
        ...(overrides.granted.length ? { granted: overrides.granted } : {}),
        ...(overrides.revoked.length ? { revoked: overrides.revoked } : {}),
      },
    });

    const head = await headers();
    const origin = head.get("origin") ?? `https://${head.get("host") ?? "localhost:3000"}`;

    revalidatePath("/team");
    return {
      ok: true,
      message: `Invitation ready for ${input.email}.`,
      data: { link: inviteUrl(token, origin), expiresAt: invitation.expiresAt.toISOString() },
    } satisfies ActionResult<{ link: string; expiresAt: string }>;
  },
});

/**
 * Changing what one person can do, feature by feature, without changing their
 * role. The same rules as an invitation: only the difference from the role is
 * stored, and nobody hands out a feature they lack.
 *
 * Guarded by `user:assign_role` rather than `user:edit`, because it is the
 * same power — choosing someone's permissions — at a finer grain.
 */
export const setUserPermissions = defineAction({
  permission: "user:assign_role",
  input: z.object({ userId: z.string().min(1), permissions: z.array(z.string()).max(200) }),
  async handler(ctx, input) {
    if (input.userId === ctx.user.id) {
      throw new UserError("You cannot change your own access. Ask another admin.", "denied");
    }

    const target = await ctx.db.user.findUnique({
      where: { id: input.userId },
      include: { role: { include: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    if (!target) throw new UserError("That person is no longer in this workspace.", "not_found");
    if (target.role.name === PROTECTED_ROLE) {
      throw new UserError("An Owner can do everything by definition. Change their role first.", "denied");
    }

    const overrides = permissionOverrides({
      roleName: target.role.name,
      roleKeys: target.role.permissions.map((rp) => rp.permission.key),
      chosen: input.permissions,
      granterKeys: ctx.scope.permissions,
    });
    if (overrides.unknown.length) {
      throw new UserError("One of those features is not recognised. Refresh and choose again.", "invalid");
    }

    // Only what changed has to be within the granter's own reach. A feature
    // somebody else already gave this person is not an escalation by the
    // person leaving it alone.
    const already = new Set(target.permissionsGranted);
    const escalations = overrides.escalations.filter((key) => !already.has(key));
    if (escalations.length) {
      throw new UserError(`You cannot give access you do not have yourself (${escalations.join(", ")}).`, "denied");
    }

    await ctx.db.user.update({
      where: { id: target.id },
      data: { permissionsGranted: overrides.granted, permissionsRevoked: overrides.revoked },
    });

    await ctx.audit({
      action: "permissions_changed",
      resourceType: "User",
      resourceId: target.id,
      resourceLabel: target.email,
      before: { role: target.role.name, granted: target.permissionsGranted, revoked: target.permissionsRevoked },
      after: { role: target.role.name, granted: overrides.granted, revoked: overrides.revoked },
    });

    revalidatePath("/team");
    const changes = overrides.granted.length + overrides.revoked.length;
    return {
      ok: true,
      message: changes
        ? `${target.name} now has ${changes} ${changes === 1 ? "change" : "changes"} from ${target.role.name}.`
        : `${target.name} is back to exactly ${target.role.name}.`,
    } satisfies ActionResult;
  },
});

export const revokeInvitation = defineAction({
  permission: "user:invite",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const invitation = await ctx.db.invitation.findUnique({ where: { id: input.id } });
    if (!invitation || invitation.acceptedAt) throw new UserError("That invitation is no longer open.", "not_found");

    await ctx.db.invitation.delete({ where: { id: input.id } });
    await ctx.audit({
      action: "invitation_revoked",
      resourceType: "Invitation",
      resourceId: invitation.id,
      resourceLabel: invitation.email,
      before: { email: invitation.email },
    });

    revalidatePath("/team");
    return { ok: true, message: "Invitation revoked." } satisfies ActionResult;
  },
});

export const setUserStatus = defineAction({
  permission: "user:deactivate",
  input: z.object({ userId: z.string().min(1), status: z.enum(["Active", "Deactivated"]) }),
  async handler(ctx, input) {
    if (input.userId === ctx.user.id) throw new UserError("You cannot deactivate your own account.");

    const target = await ctx.db.user.findUnique({ where: { id: input.userId }, include: { role: true } });
    if (!target) throw new UserError("That person is no longer in this workspace.", "not_found");

    // The workspace must keep at least one person who can restore the others.
    if (input.status === "Deactivated" && target.role.name === "Owner") {
      const owners = await ctx.db.user.count({ where: { role: { name: "Owner" }, status: "Active" } });
      if (owners <= 1) throw new UserError("This is the last active Owner. Promote someone else first.");
    }

    await ctx.db.user.update({ where: { id: input.userId }, data: { status: input.status } });

    // Deactivating must end access now, not when their cookie happens to expire.
    if (input.status === "Deactivated") await revokeAllSessions(ctx.user.tenantId, input.userId);

    await ctx.audit({
      action: input.status === "Deactivated" ? "deactivated" : "reactivated",
      resourceType: "User",
      resourceId: target.id,
      resourceLabel: target.email,
      before: { status: target.status },
      after: { status: input.status },
    });

    revalidatePath("/team");
    return { ok: true, message: `${target.name} is now ${input.status.toLowerCase()}.` } satisfies ActionResult;
  },
});

export const changeUserRole = defineAction({
  permission: "user:assign_role",
  input: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
  async handler(ctx, input) {
    const [target, role] = await Promise.all([
      ctx.db.user.findUnique({ where: { id: input.userId }, include: { role: true } }),
      ctx.db.role.findUnique({ where: { id: input.roleId } }),
    ]);
    if (!target || !role) throw new UserError("That person or role no longer exists.", "not_found");
    if (target.roleId === role.id) return { ok: true } satisfies ActionResult;

    if ((role.name === "Owner" || target.role.name === "Owner") && ctx.scope.roleName !== "Owner") {
      throw new UserError("Only an Owner can change who else is an Owner.", "denied");
    }

    if (target.role.name === "Owner" && role.name !== "Owner") {
      const owners = await ctx.db.user.count({ where: { role: { name: "Owner" }, status: "Active" } });
      if (owners <= 1) throw new UserError("This is the last Owner. Promote someone else first.");
    }

    // Hand-made changes to the old role's features are cleared. They were
    // decided against that role — "a Manager, but no approving" — and carried
    // onto another they would quietly mean something nobody chose.
    await ctx.db.user.update({
      where: { id: input.userId },
      data: { roleId: role.id, allClients: role.name !== "Member", permissionsGranted: [], permissionsRevoked: [] },
    });

    await ctx.audit({
      action: "role_changed",
      resourceType: "User",
      resourceId: target.id,
      resourceLabel: target.email,
      before: {
        role: target.role.name,
        ...(target.permissionsGranted.length ? { granted: target.permissionsGranted } : {}),
        ...(target.permissionsRevoked.length ? { revoked: target.permissionsRevoked } : {}),
      },
      after: { role: role.name },
    });

    // No session is touched: permissions are read on every request, so this is
    // in force the moment they load their next page.
    revalidatePath("/team");
    return { ok: true, message: `${target.name} is now ${role.name}.` } satisfies ActionResult;
  },
});
