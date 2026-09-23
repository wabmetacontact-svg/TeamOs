"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

// Small in-memory throttle so a stolen laptop can't brute force the login.
const attempts = new Map<string, { count: number; resetAt: number }>();
let dummyHash: string | undefined;

function rateLimit(key: string, limit = 8, windowMs = 60_000) {
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
  let next = "/dashboard";
  try {
    const input = schema.parse(Object.fromEntries(formData));
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!rateLimit(`${ip}:${input.email}`)) throw new UserError("Too many attempts. Try again in a minute.");

    const user = await db.user.findUnique({ where: { email: input.email } });
    // Always spend the same time hashing, whether or not the user exists.
    dummyHash ??= await bcrypt.hash("teamos-timing-guard", 10);
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !ok) throw new UserError("Wrong email or password.");
    if (!user.active) throw new UserError("This account has been disabled.");

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await createSession(user.id);

    const raw = formData.get("next");
    if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) next = raw;
  } catch (err) {
    return toActionError(err);
  }
  redirect(next);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
