import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db, tenantDb } from "./db";
import { effectivePermissions } from "./permissions";
import type { Scope } from "./scope";
import { twoFactorRequiredFor } from "./totp";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./session";

/**
 * Sessions are stored, not just signed.
 *
 * The architecture specifies 15-minute access tokens with rotating refresh
 * tokens — the shape you need when an API must authorise without touching the
 * database. This application reads the database on every request anyway, to
 * resolve the caller's permissions and client scope, so the rotation machinery
 * would add moving parts without adding safety.
 *
 * What it would have bought is met more directly here: the session row is
 * checked on every request, so revoking one ends that session on the very next
 * call rather than whenever a token happens to expire. The cookie is a pointer;
 * the database is the authority.
 */

// ──────────────────────────────────────────────────────────── passwords ───

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

/**
 * Verifies against Argon2id, and against bcrypt for accounts that predate it.
 * Returns whether the password was right and whether the stored hash should be
 * upgraded, so nobody has to be told to reset a working password.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (storedHash.startsWith("$2")) {
    const ok = await bcrypt.compare(plain, storedHash);
    return { ok, needsUpgrade: ok };
  }
  try {
    return { ok: await argonVerify(storedHash, plain), needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
}

/** A hash to compare against when the account does not exist, so a missing
 *  user and a wrong password take the same time. */
let decoyHash: string | undefined;
export async function spendVerificationTime(plain: string): Promise<void> {
  decoyHash ??= await argonHash(randomBytes(16).toString("hex"));
  await argonVerify(decoyHash, plain).catch(() => false);
}

/** A workspace an address can sign in to. */
export type LoginWorkspace = { tenantId: string; name: string; slug: string };

/**
 * Every workspace an email can sign in to.
 *
 * Signing in is the one read that happens before a tenant is known — the email
 * is the only thing that identifies one — so it cannot go through the tenant
 * policy like everything else. This calls a SECURITY DEFINER function that
 * returns ids and display names and nothing else; see the
 * login_tenant_resolution migration for why that leaks less than a policy
 * keyed on the address would.
 *
 * It returns a list rather than one, because the unique index on users is
 * (tenantId, email) — the same person really can work for two agencies. The
 * login form asks which when there is more than one; returning an arbitrary
 * one is a bug that only shows up after the second workspace exists.
 */
export async function resolveLoginTenants(email: string): Promise<LoginWorkspace[]> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return [];

  const rows = await db.$queryRaw<{ tenant_id: string; tenant_name: string; tenant_slug: string }[]>`
    SELECT * FROM auth_tenants_for_email(${cleaned})
  `;

  return rows.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name, slug: r.tenant_slug }));
}

/**
 * Runs a callback with the signup policy open.
 *
 * `pending_signups` is the one table that is not tenant-owned — it exists
 * before a tenant does — so it is gated on a transaction-local setting instead.
 * Everything that touches it goes through here, which is what keeps that gate
 * from being something anyone has to remember.
 */
export async function inSignupFlow<T>(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.signup_flow', 'on', TRUE)`;
    return fn(tx);
  });
}

// ───────────────────────────────────────────────────────────── sessions ───

export async function startSession(userId: string, tenantId: string): Promise<void> {
  const head = await headers();
  const session = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.session.create({
      data: {
        tenantId,
        userId,
        // The cookie is the credential; this column exists so a session can be
        // listed and revoked, never to be replayed.
        refreshTokenHash: randomBytes(32).toString("base64url"),
        family: randomBytes(16).toString("base64url"),
        userAgent: head.get("user-agent")?.slice(0, 300) ?? null,
        ip: head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      },
    });
  });

  (await cookies()).set(SESSION_COOKIE, await signSession({ sid: session.id, uid: userId, tid: tenantId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);

  if (claims) {
    // Bound to the tenant in the cookie. Without it the update matches nothing
    // and the session stays live in the database after the cookie is cleared.
    await tenantDb(claims.tid).session.updateMany({
      where: { id: claims.sid },
      data: { revokedAt: new Date() },
    });
  }

  jar.delete(SESSION_COOKIE);
}

/**
 * Ends a session from the admin side. Effective on that user's next request.
 *
 * Both of these take a tenant because every table here is behind row-level
 * security: an update that does not name one matches zero rows and reports
 * success, which is the worst possible way for a revocation to fail.
 */
export async function revokeSession(tenantId: string, sessionId: string): Promise<number> {
  const result = await tenantDb(tenantId).session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeAllSessions(tenantId: string, userId: string): Promise<number> {
  const result = await tenantDb(tenantId).session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// ──────────────────────────────────────────────────────────────── scope ───

export type CurrentUser = {
  id: string;
  tenantId: string;
  sessionId: string;
  name: string;
  email: string;
  roleName: string;
  tenantName: string;
  baseCurrency: string;
  timezone: string;
  /** Their role requires a second factor and they have not set one up yet. */
  twoFactorPending: boolean;
};

/**
 * Resolves who is asking and everything that governs what they may reach.
 * Cached for the duration of one request, recomputed on the next — which is
 * what makes a role change or a revocation take effect immediately rather than
 * at the next login.
 *
 * This runs on every click, so its cost is the floor under every page. By
 * default Prisma resolves each level of an include with its own statement:
 * session, tenant, user, role, role permissions, permissions, client scope,
 * context scope — eight SELECTs, run one after another inside the tenant
 * transaction, each paying a full round trip. Measured from India to the
 * database in Singapore that was eleven statements and ~870 ms before a page
 * did any work of its own.
 *
 * The `relationJoins` preview feature in schema.prisma turns it into one
 * statement with lateral joins: four round trips instead of eleven, ~340 ms.
 * It is on for the whole client, so every include in the application got the
 * same fix without a line of it changing.
 */
export const getScope = cache(async (): Promise<{ user: CurrentUser; scope: Scope } | null> => {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  // The cookie carries the tenant, so this read binds to it like every other.
  // Reading it off the raw client would return nothing under RLS.
  const session = await tenantDb(claims.tid).session.findFirst({
    where: { id: claims.sid, revokedAt: null, expiresAt: { gt: new Date() } },
    include: {
      tenant: { select: { id: true, name: true, baseCurrency: true, timezone: true, status: true } },
      user: {
        include: {
          role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
          scope: { select: { clientId: true } },
          contextScope: { select: { contextId: true } },
        },
      },
    },
  });

  if (!session || session.user.status !== "Active" || session.tenant.status !== "Active") return null;

  const { user, tenant } = session;
  return {
    user: {
      id: user.id,
      tenantId: tenant.id,
      sessionId: session.id,
      name: user.name,
      email: user.email,
      roleName: user.role.name,
      tenantName: tenant.name,
      baseCurrency: tenant.baseCurrency,
      timezone: tenant.timezone,
      twoFactorPending: twoFactorRequiredFor(user.role.name) && !user.twoFactorEnabled,
    },
    scope: {
      userId: user.id,
      tenantId: tenant.id,
      roleName: user.role.name,
      permissions: effectivePermissions(
        user.role.name,
        user.role.permissions.map((rp) => rp.permission.key),
        user.permissionsGranted,
        user.permissionsRevoked,
      ),
      allClients: user.allClients,
      clientIds: user.scope.map((s) => s.clientId),
      allContexts: user.allContexts,
      contextIds: user.contextScope.map((s) => s.contextId),
    },
  };
});

/**
 * Pages where someone who still owes a second factor is allowed to be: the one
 * where they can set it up, and the way out.
 */
const TWO_FACTOR_EXEMPT = ["/security", "/logout"];

/** For pages and actions that require a signed-in user. */
export async function requireScope(): Promise<{ user: CurrentUser; scope: Scope }> {
  const resolved = await getScope();
  if (!resolved) {
    // A cookie that verifies but resolves to nothing — revoked, expired, or a
    // deleted account — must be cleared, or /login bounces straight back here.
    const stale = (await cookies()).get(SESSION_COOKIE);
    redirect(stale ? "/logout" : "/login");
  }

  // An Owner or Admin without a second factor gets one page: the one where
  // they can add it. This is the redirect half; defineAction refuses the same
  // person, so the requirement does not rest on navigation alone.
  if (resolved.user.twoFactorPending) {
    const pathname = (await headers()).get("x-pathname");
    // Without the header there is no way to know whether this *is* /security,
    // and redirecting blindly would loop on the one page that fixes the
    // problem. The refusal in defineAction is the half that has to hold, so
    // this half can afford to do nothing when it cannot tell.
    if (pathname && !TWO_FACTOR_EXEMPT.some((p) => pathname.startsWith(p))) redirect("/security");
  }

  return resolved;
}

/** The tenant-bound database client for the current request. */
export async function currentDb() {
  const { user } = await requireScope();
  return tenantDb(user.tenantId);
}
