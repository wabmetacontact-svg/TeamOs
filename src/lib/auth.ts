import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import type { Member, Tenant } from "@prisma/client";
import { db, tenantDb } from "./db";
import {
  LONG_SESSION_SECONDS,
  SESSION_COOKIE,
  SHORT_SESSION_SECONDS,
  signSession,
  verifySession,
} from "./session";

/**
 * Sessions are stored, not just signed: the cookie points at a row, and the
 * row is checked on every request. Logging out, or an owner marking someone
 * as Exited, ends their access on the very next click.
 */

// ──────────────────────────────────────────────────────────── passwords ───

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}

/** Spends the same time as a real check, so a missing account and a wrong
 *  password cannot be told apart by how long the answer takes. */
let decoyHash: string | undefined;
export async function spendVerificationTime(plain: string): Promise<void> {
  decoyHash ??= await argonHash(randomBytes(16).toString("hex"));
  await argonVerify(decoyHash, plain).catch(() => false);
}

export type LoginWorkspace = { tenantId: string; name: string; slug: string };

/**
 * Every workspace an email can sign in to. Signing in is the one read that
 * happens before a tenant is known, so it goes through a SECURITY DEFINER
 * function that returns ids and names and nothing else (see the migration).
 */
export async function resolveLoginTenants(email: string): Promise<LoginWorkspace[]> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return [];
  const rows = await db.$queryRaw<{ tenant_id: string; tenant_name: string; tenant_slug: string }[]>`
    SELECT * FROM auth_tenants_for_email(${cleaned})
  `;
  return rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name, slug: r.tenant_slug }));
}

// ───────────────────────────────────────────────────────────── sessions ───

export async function startSession(memberId: string, tenantId: string, remember: boolean): Promise<void> {
  const head = await headers();
  const ttl = remember ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS;

  const session = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    await tx.member.update({ where: { id: memberId }, data: { lastLoginAt: new Date() } });
    return tx.session.create({
      data: {
        tenantId,
        memberId,
        userAgent: head.get("user-agent")?.slice(0, 300) ?? null,
        ip: head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
  });

  (await cookies()).set(SESSION_COOKIE, await signSession({ sid: session.id, uid: memberId, tid: tenantId }, ttl), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Without "keep me signed in" the cookie dies with the browser.
    ...(remember ? { maxAge: ttl } : {}),
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (claims) {
    await tenantDb(claims.tid).session.updateMany({ where: { id: claims.sid }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(PREVIEW_COOKIE);
}

// ──────────────────────────────────────────────────────────────── who ───

/** An owner looking at the workspace through someone else's access. */
export const PREVIEW_COOKIE = "ops_preview";

export type Signed = {
  sessionId: string;
  tenant: Tenant;
  me: Member;
  /** Whose access the screens are built for. `me` unless an owner previews. */
  viewer: Member;
  previewing: boolean;
};

/**
 * Who is asking, read fresh from the database on every request and cached for
 * the rest of that request.
 */
export const getSigned = cache(async (): Promise<Signed | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const session = await tenantDb(claims.tid).session.findFirst({
    where: { id: claims.sid, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { tenant: true, member: true },
  });
  if (!session) return null;
  const { tenant, member: me } = session;
  if (tenant.status !== "Active" || me.hrStatus === "Exited" || !me.passwordHash) return null;

  // Previewing is an owner's tool and nothing more: anyone else holding the
  // cookie simply sees their own access.
  let viewer = me;
  const previewId = jar.get(PREVIEW_COOKIE)?.value;
  if (me.isOwner && previewId && previewId !== me.id) {
    const other = await tenantDb(tenant.id).member.findFirst({ where: { id: previewId } });
    if (other) viewer = other;
  }

  return { sessionId: session.id, tenant, me, viewer, previewing: viewer.id !== me.id };
});

/** For pages: the signed-in person, or a trip to the login page. */
export async function requireSigned(): Promise<Signed> {
  const signed = await getSigned();
  if (!signed) {
    // A cookie that verifies but resolves to nothing must be cleared, or the
    // login page would bounce straight back here.
    const stale = (await cookies()).get(SESSION_COOKIE);
    redirect(stale ? "/logout" : "/login");
  }
  return signed;
}
