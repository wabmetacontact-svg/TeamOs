import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ops_session";
/** "Keep me signed in": a month. */
export const LONG_SESSION_SECONDS = 60 * 60 * 24 * 30;
/** Otherwise the cookie lives until the browser closes, and never past a day. */
export const SHORT_SESSION_SECONDS = 60 * 60 * 24;

/**
 * The cookie carries a pointer, not an authority. Every request looks the
 * session row up and re-reads the member, so a revoked session or a changed
 * grant takes effect on the very next request. The claims are only enough to
 * find the row and to let the proxy make a cheap optimistic decision.
 */
export type SessionClaims = { sid: string; uid: string; tid: string };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const { sid, uid, tid } = payload as Record<string, unknown>;
    if (typeof sid !== "string" || typeof uid !== "string" || typeof tid !== "string") return null;
    return { sid, uid, tid };
  } catch {
    return null;
  }
}
