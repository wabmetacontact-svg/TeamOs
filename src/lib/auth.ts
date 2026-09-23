import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { isManager } from "./constants";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./session";

export async function createSession(userId: string) {
  const token = await signSession({ uid: userId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async () => {
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const user = await db.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, name: true, email: true, role: true, active: true, designation: true },
  });
  if (!user || !user.active) return null;
  return user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser() {
  const user = await getCurrentUser();
  if (user) return user;
  // A cookie that still verifies but has no user behind it (database reset,
  // deleted or disabled account) must be cleared, or /login bounces back here.
  const stale = (await cookies()).get(SESSION_COOKIE);
  redirect(stale ? "/logout" : "/login");
}

/** Money and team-wide screens. Throws inside actions, redirects on pages. */
export async function requireManager() {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError();
  return user;
}

export async function requireManagerPage() {
  const user = await requireUser();
  if (!isManager(user.role)) redirect("/dashboard?denied=1");
  return user;
}

export class AccessError extends Error {
  name = "AccessError";
  constructor(message = "You don't have access to this.") {
    super(message);
  }
}
