import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ops_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * The cookie carries a pointer, not an authority. Every request looks the
 * session up and re-reads the role, so the claims here are only enough to find
 * the row and to let the proxy make a cheap optimistic decision.
 */
export type SessionClaims = { sid: string; uid: string; tid: string };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const { sid, uid, tid, stage } = payload as Record<string, unknown>;
    // A half-authenticated challenge token must never be mistaken for a session.
    if (stage) return null;
    if (typeof sid !== "string" || typeof uid !== "string" || typeof tid !== "string") return null;
    return { sid, uid, tid };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────── the gap between the factors ───

export const CHALLENGE_COOKIE = "ops_2fa";
/** Long enough to find a phone, short enough that a borrowed laptop is safe. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Between a correct password and a correct code there is a caller who is
 * half-authenticated: proved one factor, owed the other. This cookie is what
 * carries them across that gap.
 *
 * It is deliberately not a session — there is no row behind it, it expires in
 * minutes, and `verifySession` will not accept it, because the two are signed
 * with different claim shapes. Holding one grants nothing except the right to
 * be asked for a code.
 */
export type ChallengeClaims = { uid: string; tid: string; nonce: string; next?: string };

export async function signChallenge(claims: ChallengeClaims): Promise<string> {
  return new SignJWT({ ...claims, stage: "totp" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyChallenge(token: string | undefined): Promise<ChallengeClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const { uid, tid, nonce, next, stage } = payload as Record<string, unknown>;
    // A session cookie replayed here must not pass as a challenge, and a
    // challenge must not pass as a session.
    if (stage !== "totp") return null;
    if (typeof uid !== "string" || typeof tid !== "string" || typeof nonce !== "string") return null;
    return { uid, tid, nonce, next: typeof next === "string" ? next : undefined };
  } catch {
    return null;
  }
}

/** Shared by every place that sets one of these cookies, so the flags cannot
 *  drift apart between the login route and the verify route. */
export function newChallengeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}
