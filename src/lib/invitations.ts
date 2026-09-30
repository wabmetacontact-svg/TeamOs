import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db, tenantDb } from "./db";

/**
 * Invitations.
 *
 * The link is the credential, so it is treated like one: a 32-byte random
 * token goes in the URL and only its SHA-256 lands in the database. A leaked
 * backup therefore hands nobody a working invite, and an admin looking at the
 * table cannot sign in as the person they invited.
 *
 * SHA-256 rather than Argon2 here on purpose. Argon2 is slow by design because
 * passwords are guessable; a 256-bit random token is not, and the lookup has
 * to be an indexed equality match on a unique column rather than a scan that
 * verifies every row.
 *
 * Three things make it single-use: `acceptedAt` is set inside the same
 * transaction that creates the user, the unique index on (tenantId, email)
 * stops a second account even if two requests race, and the token is hashed so
 * it cannot be recovered from the row afterwards.
 */

export const INVITE_TTL_HOURS = 72;

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteUrl(token: string, origin: string): string {
  return new URL(`/invite/${token}`, origin).toString();
}

export type InviteState = "valid" | "expired" | "accepted" | "unknown";

export type PendingInvite = {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string | null;
  roleId: string;
  roleName: string;
  allClients: boolean;
  clientIds: string[];
  permissionsGranted: string[];
  permissionsRevoked: string[];
  expiresAt: Date;
  invitedByName: string;
};

/**
 * Resolves a token from the URL, in two steps, because of an ordering problem
 * that is easy to miss: row-level security wants a tenant, and the only thing
 * that names the tenant is the token we are about to look up.
 *
 * Step one reads the invitation under the `invite_by_token` policy, which makes
 * a row visible to whoever can name its hash — see the migration for why that
 * grants nothing new. Step two re-reads the same row bound to the tenant the
 * first step revealed, so the joined workspace, role and inviter come back
 * through the ordinary policy rather than through the escape.
 */
export async function lookupInvite(
  token: string,
): Promise<{ state: InviteState; invite?: PendingInvite }> {
  if (!token || token.length < 16) return { state: "unknown" };
  const tokenHash = hashToken(token);

  const found = await db.$transaction(async (tx) => {
    // Transaction-local: it cannot outlive this statement onto a pooled
    // connection serving somebody else.
    await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${tokenHash}, TRUE)`;
    return tx.invitation.findUnique({ where: { tokenHash }, select: { id: true, tenantId: true } });
  });

  if (!found) return { state: "unknown" };

  const row = await tenantDb(found.tenantId).invitation.findUnique({
    where: { id: found.id },
    include: {
      tenant: { select: { name: true, status: true } },
      role: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
  });

  // An unknown token and a token for a suspended tenant look the same on
  // purpose: neither should confirm that the other kind exists.
  if (!row || row.tenant.status !== "Active") return { state: "unknown" };
  if (row.acceptedAt) return { state: "accepted" };
  if (row.expiresAt < new Date()) return { state: "expired" };

  return {
    state: "valid",
    invite: {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      email: row.email,
      name: row.name,
      roleId: row.roleId,
      roleName: row.role.name,
      allClients: row.allClients,
      clientIds: row.clientIds,
      permissionsGranted: row.permissionsGranted,
      permissionsRevoked: row.permissionsRevoked,
      expiresAt: row.expiresAt,
      invitedByName: row.invitedBy.name,
    },
  };
}
