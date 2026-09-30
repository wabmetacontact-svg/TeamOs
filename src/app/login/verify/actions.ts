"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tenantDb } from "@/lib/db";
import { toActionError, UserError, type ActionResult } from "@/lib/action";
import { CHALLENGE_COOKIE, verifyChallenge } from "@/lib/session";
import { matchRecoveryCode, verifyTotp } from "@/lib/totp";
import { finishSignIn } from "../actions";

/**
 * The second factor.
 *
 * Everything here is re-read rather than carried over from the password step:
 * the account may have been deactivated, the workspace suspended, or two-factor
 * turned off in the minutes since. The challenge cookie says only which account
 * proved a password, and how recently.
 */

const schema = z.object({ code: z.string().trim().min(1, "Enter the code from your app") });

/** Six digits is a small space; this keeps it from being walked. */
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooMany(key: string, limit = 6, windowMs = 300_000): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

export async function verifyTwoFactor(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let destination = "/dashboard";

  try {
    const { code } = schema.parse(Object.fromEntries(formData));
    const jar = await cookies();
    const challenge = await verifyChallenge(jar.get(CHALLENGE_COOKIE)?.value);

    if (!challenge) throw new UserError("That took too long. Sign in again.", "unauthenticated");
    if (tooMany(`2fa:${challenge.uid}`)) {
      throw new UserError("Too many wrong codes. Wait five minutes and sign in again.", "denied");
    }

    // The challenge cookie carries the tenant, so this one can bind to it.
    const user = await tenantDb(challenge.tid).user.findFirst({
      where: { id: challenge.uid },
      include: { tenant: { select: { status: true } } },
    });

    if (!user || user.status !== "Active" || user.tenant.status !== "Active") {
      jar.delete(CHALLENGE_COOKIE);
      throw new UserError("This account is no longer active.", "denied");
    }

    // Turned off between the two steps: the password already stands, so let
    // them in rather than asking for a code no app is generating any more.
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      jar.delete(CHALLENGE_COOKIE);
      await finishSignIn(user, "password");
      destination = challenge.next ?? "/dashboard";
      redirect(destination);
    }

    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const isRecovery = /[a-z]/i.test(code);
    let method: "totp" | "recovery_code";

    if (isRecovery) {
      const spent = matchRecoveryCode(code, user.twoFactorRecovery);
      if (!spent) throw new UserError("That code is not right. Check it and try again.", "denied");

      // Removed in the same statement that checks it is still there, so two
      // simultaneous uses of one code cannot both succeed.
      const used = await tenantDb(user.tenantId).$transaction(async (tx) => {
        const result = await tx.user.updateMany({
          where: { id: user.id, twoFactorRecovery: { has: spent } },
          data: { twoFactorRecovery: user.twoFactorRecovery.filter((h) => h !== spent) },
        });
        if (result.count === 1) {
          await tx.auditEntry.create({
            data: {
              tenantId: user.tenantId,
              actorId: user.id,
              action: "recovery_code_used",
              resourceType: "User",
              resourceId: user.id,
              resourceLabel: user.email,
              after: { remaining: user.twoFactorRecovery.length - 1 },
              ip,
            },
          });
        }
        return result.count;
      });

      if (used !== 1) throw new UserError("That code has already been used.", "denied");
      method = "recovery_code";
    } else {
      const { ok, step } = verifyTotp(user.twoFactorSecret!, code, { lastUsedStep: user.twoFactorLastStep });
      if (!ok) {
        throw new UserError(
          user.twoFactorLastStep != null && verifyTotp(user.twoFactorSecret!, code).ok
            ? "That code was already used. Wait for the next one."
            : "That code is not right. Check your app's clock and try again.",
          "denied",
        );
      }

      // Recording the step is what stops the same code being used twice inside
      // its 30-second life.
      await tenantDb(user.tenantId).user.update({
        where: { id: user.id },
        data: { twoFactorLastStep: step },
      });
      method = "totp";
    }

    attempts.delete(`2fa:${challenge.uid}`);
    jar.delete(CHALLENGE_COOKIE);
    await finishSignIn(user, method);
    destination = challenge.next ?? "/dashboard";
  } catch (err) {
    return toActionError(err);
  }

  redirect(destination);
}

/** Backing out of the code prompt without leaving a half-authenticated cookie. */
export async function cancelTwoFactor(): Promise<void> {
  (await cookies()).delete(CHALLENGE_COOKIE);
  redirect("/login");
}
