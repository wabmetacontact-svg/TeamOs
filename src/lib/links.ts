import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { db, tenantDb } from "./db";

/**
 * Login links: how somebody added to the team sets their password, and how
 * somebody who forgot theirs gets back in. There is no mail server, so the
 * owner copies the link and sends it themselves.
 *
 * Only a SHA-256 of the token is stored. The token is shown once.
 */

export const LINK_TTL_DAYS = 7;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export async function linkUrl(token: string): Promise<string> {
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
  return `${origin}/join/${token}`;
}

export type LinkState = "valid" | "used" | "expired" | "unknown";

/**
 * Resolves a token in two steps, because row-level security wants a tenant and
 * the token is the only thing that names one. The first read goes through the
 * token-hash policy and learns only the row's tenant; the second reads the
 * rest under the ordinary tenant policy.
 */
export async function lookupLink(token: string) {
  if (!token || token.length < 20) return { state: "unknown" as LinkState };
  const tokenHash = hashToken(token);

  const found = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.link_token_hash', ${tokenHash}, TRUE)`;
    return tx.loginLink.findUnique({ where: { tokenHash }, select: { id: true, tenantId: true } });
  });
  if (!found) return { state: "unknown" as LinkState };

  const link = await tenantDb(found.tenantId).loginLink.findUnique({
    where: { id: found.id },
    include: { member: true, tenant: true },
  });
  if (!link || link.tenant.status !== "Active" || link.member.hrStatus === "Exited") return { state: "unknown" as LinkState };
  if (link.usedAt) return { state: "used" as LinkState };
  if (link.expiresAt < new Date()) return { state: "expired" as LinkState };
  return { state: "valid" as LinkState, link };
}
