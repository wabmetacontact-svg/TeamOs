"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, tenantDb } from "@/lib/db";
import { endSession, hashPassword, resolveLoginTenants, spendVerificationTime, startSession, verifyPassword } from "@/lib/auth";
import type { ActionResult } from "@/lib/action";
import { toActionError, UserError } from "@/lib/action";
import { CHALLENGE_COOKIE, newChallengeCookieOptions, signChallenge } from "@/lib/session";
import { newChallengeNonce } from "@/lib/totp";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/**
 * Per account and per address, so neither one account nor one machine can be
 * hammered. In-process for now; it moves to Redis when Redis arrives, which is
 * also when a second instance would make this insufficient.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

export async function loginAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let destination = "/dashboard";
  try {
    const input = schema.parse(Object.fromEntries(formData));
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

    if (!rateLimit(`ip:${ip}`, 20) || !rateLimit(`account:${input.email}`, 8)) {
      throw new UserError("Too many attempts. Try again in a minute.", "denied");
    }

    // Two steps, because of an ordering problem that is easy to miss: every
    // table here is behind row-level security, which needs a tenant, and at
    // this moment the email is the only thing that names one. Step one asks a
    // SECURITY DEFINER function for the tenant id alone; step two reads the
    // user under the ordinary policy, bound to it.
    //
    // Written as one query on the raw client, this returns null for every
    // account that exists and refuses every login as "wrong password".
    const workspaces = await resolveLoginTenants(input.email);

    // The same address can belong to two workspaces, so the form asks which
    // once the password is known to be right — asking before would tell an
    // outsider which addresses exist and where.
    const chosen = String(formData.get("workspace") ?? "");
    const tenantId =
      workspaces.length === 1
        ? workspaces[0]!.tenantId
        : (workspaces.find((w) => w.tenantId === chosen)?.tenantId ?? workspaces[0]?.tenantId);

    const user = tenantId
      ? await tenantDb(tenantId).user.findFirst({
          where: { email: input.email },
          include: { tenant: { select: { id: true, status: true } } },
        })
      : null;

    if (!user) {
      await spendVerificationTime(input.password);
      throw new UserError("Wrong email or password.", "denied");
    }

    const { ok, needsUpgrade } = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new UserError("Wrong email or password.", "denied");
    if (user.status !== "Active") throw new UserError("This account has been deactivated.", "denied");
    if (user.tenant.status !== "Active") throw new UserError("This workspace is not active.", "denied");

    // The plaintext is in hand only here, so the upgrade happens here — before
    // the second factor, which may not be completed. An account that stalls at
    // the code prompt still gets the better hash, and nobody is asked to reset
    // a working password.
    if (needsUpgrade) {
      const passwordHash = await hashPassword(input.password);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      });
    }

    // Password proved. Only now is it safe to say there is more than one.
    if (workspaces.length > 1 && !workspaces.some((w) => w.tenantId === chosen)) {
      return {
        ok: false,
        code: "invalid",
        error: "You belong to more than one workspace. Which one?",
        fieldErrors: { workspace: workspaces.map((w) => `${w.tenantId}:${w.name}`) },
      };
    }

    const next = formData.get("next");
    const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

    // The password was right, and that is only half of it. No session is
    // created here — the challenge cookie proves one factor and nothing more.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const token = await signChallenge({
        uid: user.id,
        tid: user.tenantId,
        nonce: newChallengeNonce(),
        next: safeNext,
      });
      (await cookies()).set(CHALLENGE_COOKIE, token, newChallengeCookieOptions());
      redirect("/login/verify");
    }

    await finishSignIn({ id: user.id, tenantId: user.tenantId, email: user.email }, "password");
    if (safeNext) destination = safeNext;
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}

/**
 * The last step of every route into the application — one factor or two, a
 * password or a recovery code. Recording the method it took is the difference
 * between an audit trail and a list of timestamps.
 */
export async function finishSignIn(
  user: { id: string; tenantId: string; email: string },
  method: "password" | "totp" | "recovery_code",
): Promise<void> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await tx.auditEntry.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "logged_in",
        resourceType: "User",
        resourceId: user.id,
        resourceLabel: user.email,
        after: { method },
        ip,
      },
    });
  });

  await startSession(user.id, user.tenantId);
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
