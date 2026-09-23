import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "teamos_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type SessionPayload = { uid: string };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.uid === "string" ? { uid: payload.uid } : null;
  } catch {
    return null;
  }
}
