"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, inSignupFlow, resolveLoginTenants, startSession } from "@/lib/auth";
import { toActionError, UserError, type ActionResult } from "@/lib/action";
import { hashToken, newInviteToken } from "@/lib/invitations";
import { sendMail, verificationEmail } from "@/lib/mail";
import { provisionTenant } from "@/lib/provisioning";

/**
 * Creating a workspace.
 *
 * Signing up does not create anything except a pending row. The tenant, its
 * roles, its categories and its first user all come into existence when somebody
 * clicks the link — because until then nobody has proved they can read the
 * address, and an unverified signup that provisioned a real workspace would let
 * one person mint a thousand of them from addresses they do not own.
 *
 * The cost is one extra step for an honest person and most of the abuse surface
 * for everybody else, which is the right trade.
 *
 * `pending_signups` is the only table in this database that is not tenant-owned
 * — it exists before a tenant does — so every touch goes through
 * `inSignupFlow`, which opens its policy for exactly one transaction.
 */

const VERIFY_TTL_HOURS = 24;

/** Addresses that exist to be thrown away. Not exhaustive, and does not need to
 *  be: it only has to make casual abuse more work than it is worth. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "throwawaymail.com",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "temp-mail.org",
  "fakeinbox.com", "maildrop.cc", "dispostable.com", "mytemp.email", "moakt.com",
]);

const schema = z
  .object({
    workspaceName: z.string().trim().min(2, "Give the workspace a name").max(60),
    name: z.string().trim().min(1, "Your name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match" });

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number, windowMs = 3600_000): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

async function verifyLink(token: string): Promise<string> {
  const head = await headers();
  const origin = head.get("origin") ?? `https://${head.get("host") ?? "localhost:3000"}`;
  return new URL(`/signup/verify/${token}`, origin).toString();
}

export async function signUp(_: ActionResult<{ link?: string }> | null, formData: FormData): Promise<ActionResult<{ link?: string }>> {
  try {
    const input = schema.parse(Object.fromEntries(formData));
    const head = await headers();
    const ip = head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

    if (!rateLimit(`ip:${ip}`, 5) || !rateLimit(`email:${input.email}`, 3)) {
      throw new UserError("Too many attempts. Try again in an hour.", "denied");
    }

    const domain = input.email.split("@")[1] ?? "";
    if (DISPOSABLE.has(domain)) {
      throw new UserError("Use a real address — this is for a workspace you will keep.", "invalid", {
        email: ["Disposable addresses are not accepted"],
      });
    }

    // Told plainly rather than silently refused: the alternative teaches
    // nothing and they try again with the same details.
    const existing = await resolveLoginTenants(input.email);
    if (existing.length > 0) {
      throw new UserError("That email already has an account. Sign in instead.", "conflict", {
        email: ["Already registered"],
      });
    }

    const { token, tokenHash } = newInviteToken();
    const passwordHash = await hashPassword(input.password);

    await inSignupFlow(async (tx) => {
      // Signing up again replaces the outstanding request rather than stacking
      // a second live link beside it.
      await tx.pendingSignup.deleteMany({ where: { email: input.email, claimedAt: null } });
      await tx.pendingSignup.create({
        data: {
          email: input.email,
          name: input.name,
          workspaceName: input.workspaceName,
          passwordHash,
          tokenHash,
          ip: ip === "local" ? null : ip,
          userAgent: head.get("user-agent")?.slice(0, 300) ?? null,
          expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3600_000),
        },
      });
    });

    const link = await verifyLink(token);
    const sent = await sendMail({
      to: input.email,
      subject: `Confirm your email for ${input.workspaceName}`,
      text: verificationEmail(link, input.workspaceName),
    });

    return {
      ok: true,
      // With no mail provider the link comes back and the page shows it.
      // Saying "check your email" when nothing was sent is the one thing not
      // to do.
      data: sent.delivered ? {} : { link },
      message: sent.delivered ? `Sent to ${input.email}.` : "No mail provider is configured, so here is the link.",
    };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Claims a verification link: creates the workspace and signs the new Owner
 * straight in. They have just proved the address and just chose the password;
 * asking for it again would be asking twice.
 */
export async function claimSignup(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let signedIn: { userId: string; tenantId: string } | null = null;

  try {
    const token = String(formData.get("token") ?? "");
    if (token.length < 16) throw new UserError("That link is not valid.", "denied");

    const pending = await inSignupFlow((tx) =>
      tx.pendingSignup.findUnique({ where: { tokenHash: hashToken(token) } }),
    );

    if (!pending) throw new UserError("That link is not valid.", "denied");
    if (pending.claimedAt) throw new UserError("That link has already been used. Try signing in.", "denied");
    if (pending.expiresAt < new Date()) throw new UserError("That link has expired. Sign up again.", "denied");

    // Checked again rather than trusted from the signup: minutes may have
    // passed, and somebody else may have taken the address in between.
    const taken = await resolveLoginTenants(pending.email);
    if (taken.length > 0) throw new UserError("That email already has an account. Sign in instead.", "conflict");

    const workspace = await provisionTenant({
      workspaceName: pending.workspaceName,
      ownerEmail: pending.email,
      ownerName: pending.name,
      passwordHash: pending.passwordHash,
    });

    await inSignupFlow((tx) =>
      tx.pendingSignup.update({
        where: { id: pending.id },
        // Claimed only once the workspace exists — the other order would burn
        // the link on a provision that then failed. The hash is cleared
        // because it lives on the user row now, and a second copy in a table
        // with a weaker policy is a second copy that can leak.
        data: { claimedAt: new Date(), passwordHash: "" },
      }),
    );

    signedIn = { userId: workspace.userId, tenantId: workspace.tenantId };
  } catch (err) {
    return toActionError(err);
  }

  // Outside the try: both of these throw by design.
  await startSession(signedIn.userId, signedIn.tenantId);
  redirect("/welcome");
}

/** Sends the verification link again, at most a few times. */
export async function resendVerification(
  _: ActionResult<{ link?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ link?: string }>> {
  try {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    const pending = await inSignupFlow((tx) =>
      tx.pendingSignup.findFirst({ where: { email, claimedAt: null } }),
    );

    // Deliberately the same answer whether or not a request exists, so this
    // cannot be used to find out who has signed up.
    if (!pending) return { ok: true, message: "If that address has a pending signup, the link has been sent again." };

    if (pending.resendCount >= 3) throw new UserError("That has been sent three times already. Sign up again.", "denied");
    if (Date.now() - pending.lastSentAt.getTime() < 60_000) {
      throw new UserError("Just sent. Give it a minute.", "denied");
    }

    // The old token goes: two live links to one workspace is one too many.
    const { token, tokenHash } = newInviteToken();

    await inSignupFlow((tx) =>
      tx.pendingSignup.update({
        where: { id: pending.id },
        data: {
          tokenHash,
          resendCount: { increment: 1 },
          lastSentAt: new Date(),
          expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3600_000),
        },
      }),
    );

    const link = await verifyLink(token);
    const sent = await sendMail({
      to: pending.email,
      subject: `Confirm your email for ${pending.workspaceName}`,
      text: verificationEmail(link, pending.workspaceName),
    });

    return {
      ok: true,
      data: sent.delivered ? {} : { link },
      message: sent.delivered ? "Sent again." : "No mail provider is configured, so here is the link.",
    };
  } catch (err) {
    return toActionError(err);
  }
}
