"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, tenantDb } from "@/lib/db";
import { requireScope, verifyPassword } from "@/lib/auth";
import { toActionError, UserError, type ActionResult } from "@/lib/action";
import {
  newRecoveryCodes,
  newTotpSecret,
  totpUri,
  twoFactorRequiredFor,
  verifyTotp,
} from "@/lib/totp";

/**
 * Managing your own two-factor.
 *
 * These are not defineAction, deliberately. defineAction asks "does your role
 * permit this action on the workspace's data"; none of this is workspace data.
 * It is your own account, and the only authority that matters is that you are
 * signed in — which requireScope establishes — and, for anything destructive,
 * that you can still produce your password.
 */

/**
 * Begins setup: mints a secret and stores it unconfirmed. Nothing is switched
 * on until a code proves the secret actually reached an authenticator app —
 * enabling on the strength of a scan nobody verified is how people lock
 * themselves out.
 */
export async function beginTwoFactorSetup(): Promise<ActionResult<{ uri: string; secret: string }>> {
  try {
    const { user } = await requireScope();

    const existing = await tenantDb(user.tenantId).user.findUniqueOrThrow({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (existing.twoFactorEnabled) throw new UserError("Two-step is already on for this account.");

    const secret = newTotpSecret();
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
      // twoFactorEnabled stays false: the secret exists, the protection does not.
      await tx.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });
    });

    return { ok: true, data: { uri: totpUri(secret, user.email, user.tenantName), secret } };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Finishes setup. The code is what turns it on, and the recovery codes are
 * returned here once — this is the only moment they exist in plaintext.
 */
export async function confirmTwoFactorSetup(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  try {
    const { code } = z.object({ code: z.string().trim().min(6) }).parse(input);
    const { user } = await requireScope();

    const row = await tenantDb(user.tenantId).user.findUniqueOrThrow({
      where: { id: user.id },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (row.twoFactorEnabled) throw new UserError("Two-step is already on for this account.");
    if (!row.twoFactorSecret) throw new UserError("Start again — that setup expired.");

    const { ok, step } = verifyTotp(row.twoFactorSecret, code);
    if (!ok) throw new UserError("That code is not right. Check your app's clock and try again.", "denied");

    const { codes, hashes } = newRecoveryCodes();

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorAddedAt: new Date(),
          twoFactorRecovery: hashes,
          twoFactorLastStep: step,
        },
      });
      await tx.auditEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "two_factor_enabled",
          resourceType: "User",
          resourceId: user.id,
          resourceLabel: user.email,
        },
      });
    });

    revalidatePath("/security");
    return { ok: true, data: { recoveryCodes: codes }, message: "Two-step verification is on." };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Turning it off costs a password, because the session cookie alone is exactly
 * what an attacker who borrowed an unlocked laptop already has.
 */
export async function disableTwoFactor(input: { password: string }): Promise<ActionResult> {
  try {
    const { password } = z.object({ password: z.string().min(1, "Enter your password") }).parse(input);
    const { user, scope } = await requireScope();

    if (twoFactorRequiredFor(scope.roleName)) {
      throw new UserError(`Two-step is required for ${scope.roleName}s and cannot be turned off.`, "denied");
    }

    const row = await tenantDb(user.tenantId).user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    const { ok } = await verifyPassword(row.passwordHash, password);
    if (!ok) throw new UserError("That password is not right.", "denied");

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorAddedAt: null,
          twoFactorRecovery: [],
          twoFactorLastStep: null,
        },
      });
      await tx.auditEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "two_factor_disabled",
          resourceType: "User",
          resourceId: user.id,
          resourceLabel: user.email,
        },
      });
    });

    revalidatePath("/security");
    return { ok: true, message: "Two-step verification is off." };
  } catch (err) {
    return toActionError(err);
  }
}

/** New recovery codes, which invalidate the old set. Also costs a password. */
export async function regenerateRecoveryCodes(input: { password: string }): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  try {
    const { password } = z.object({ password: z.string().min(1, "Enter your password") }).parse(input);
    const { user } = await requireScope();

    const row = await tenantDb(user.tenantId).user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, twoFactorEnabled: true },
    });
    if (!row.twoFactorEnabled) throw new UserError("Turn two-step on first.");

    const { ok } = await verifyPassword(row.passwordHash, password);
    if (!ok) throw new UserError("That password is not right.", "denied");

    const { codes, hashes } = newRecoveryCodes();
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
      await tx.user.update({ where: { id: user.id }, data: { twoFactorRecovery: hashes } });
      await tx.auditEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "recovery_codes_regenerated",
          resourceType: "User",
          resourceId: user.id,
          resourceLabel: user.email,
        },
      });
    });

    revalidatePath("/security");
    return { ok: true, data: { recoveryCodes: codes }, message: "Your old codes no longer work." };
  } catch (err) {
    return toActionError(err);
  }
}

/** Ends every other session. Useful the moment you suspect one is not yours. */
export async function signOutEverywhereElse(): Promise<ActionResult<{ ended: number }>> {
  try {
    const { user } = await requireScope();

    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
      const ended = await tx.session.updateMany({
        where: { userId: user.id, id: { not: user.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "sessions_revoked",
          resourceType: "User",
          resourceId: user.id,
          resourceLabel: user.email,
          after: { ended: ended.count },
        },
      });
      return ended.count;
    });

    revalidatePath("/security");
    return {
      ok: true,
      data: { ended: result },
      message: result === 0 ? "No other sessions were open." : `Ended ${result} other ${result === 1 ? "session" : "sessions"}.`,
    };
  } catch (err) {
    return toActionError(err);
  }
}
