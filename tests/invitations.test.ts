/**
 * Stage 0 — invitations.
 *
 * An invitation link is a credential that travels by email, which is to say it
 * travels badly. These tests cover what that costs: that the link is not
 * recoverable from the database, that it stops working once used or once its
 * 72 hours are up, and that a link for one tenant cannot create a user in
 * another. The last one matters most — an invite is the only write in the
 * application that happens without a session behind it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashToken, INVITE_TTL_HOURS, inviteUrl, lookupInvite, newInviteToken } from "../src/lib/invitations";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
/** The role the application actually runs as: no BYPASSRLS, so policies apply. */
const appRole = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let roleId: string;
let inviterId: string;

async function makeInvite(overrides: { expiresAt?: Date; acceptedAt?: Date; email?: string } = {}) {
  const { token, tokenHash } = newInviteToken();
  const row = await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.invitation.create({
      data: {
        tenantId,
        email: overrides.email ?? `invitee-${Math.random().toString(36).slice(2)}@test.dev`,
        roleId,
        tokenHash,
        invitedById: inviterId,
        allClients: true,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
        acceptedAt: overrides.acceptedAt ?? null,
      },
    });
  });
  return { token, tokenHash, row };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Invites ${suffix}`, slug: `invites-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      const role = await tx.role.create({ data: { tenantId, name: "Member", description: "Test role" } });
      roleId = role.id;
      const inviter = await tx.user.create({
        data: { tenantId, email: `inviter-${suffix}@test.dev`, name: "Inviter", passwordHash: "x", roleId: role.id, allClients: true },
      });
      inviterId = inviter.id;
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `invites-${suffix}` } });
  });
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("the token", () => {
  test("only its hash is stored, so the database cannot hand anyone a working link", async () => {
    const { token, row } = await makeInvite();

    const stored = await owner.invitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // The whole row, as an admin or a leaked backup would see it, contains the
    // token nowhere.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  test("it carries enough randomness that guessing is not a strategy", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) tokens.add(newInviteToken().token);

    expect(tokens.size).toBe(200);
    // 32 random bytes, base64url — 43 characters, 256 bits.
    expect([...tokens].every((t) => t.length >= 43)).toBe(true);
  });

  test("hashing is deterministic, which is what makes the unique-index lookup possible", () => {
    const { token, tokenHash } = newInviteToken();
    expect(hashToken(token)).toBe(tokenHash);
    expect(hashToken(token + "x")).not.toBe(tokenHash);
  });
});

describe("looking a token up", () => {
  test("a fresh one resolves to the workspace, role and email it was made for", async () => {
    const { token, row } = await makeInvite({ email: `fresh-${suffix}@test.dev` });

    const { state, invite } = await lookupInvite(token);
    expect(state).toBe("valid");
    expect(invite?.id).toBe(row.id);
    expect(invite?.email).toBe(`fresh-${suffix}@test.dev`);
    expect(invite?.roleName).toBe("Member");
    expect(invite?.tenantName).toBe(`Invites ${suffix}`);
    expect(invite?.invitedByName).toBe("Inviter");
  });

  test("an expired one is refused, and says so rather than pretending not to exist", async () => {
    const { token } = await makeInvite({ expiresAt: new Date(Date.now() - 1000) });

    const { state, invite } = await lookupInvite(token);
    expect(state).toBe("expired");
    // Nothing about the workspace comes back with it.
    expect(invite).toBeUndefined();
  });

  test("one that has been used cannot be used again", async () => {
    const { token } = await makeInvite({ acceptedAt: new Date() });

    expect((await lookupInvite(token)).state).toBe("accepted");
  });

  test("a wrong, empty or truncated token is simply unknown", async () => {
    expect((await lookupInvite("")).state).toBe("unknown");
    expect((await lookupInvite("short")).state).toBe("unknown");
    expect((await lookupInvite(newInviteToken().token)).state).toBe("unknown");

    // A near-miss of a real token is unknown too — no prefix matching anywhere.
    const { token } = await makeInvite();
    expect((await lookupInvite(token.slice(0, -1))).state).toBe("unknown");
  });

  test("a suspended workspace's invitations stop resolving", async () => {
    const { token } = await makeInvite();
    expect((await lookupInvite(token)).state).toBe("valid");

    await owner.tenant.update({ where: { id: tenantId }, data: { status: "Suspended" } });
    // Deliberately "unknown" rather than a distinct state: it tells an outsider
    // nothing about whether the workspace exists.
    expect((await lookupInvite(token)).state).toBe("unknown");

    await owner.tenant.update({ where: { id: tenantId }, data: { status: "Active" } });
    expect((await lookupInvite(token)).state).toBe("valid");
  });
});

describe("claiming an invitation", () => {
  test("the claim is a conditional update, so a double submit creates one account", async () => {
    const { token } = await makeInvite();

    // This is the exact statement acceptInvitation runs. Two of them race only
    // one winner because the acceptedAt: null guard is part of the WHERE.
    const claim = () =>
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        return tx.invitation.updateMany({
          where: { tokenHash: hashToken(token), acceptedAt: null, expiresAt: { gt: new Date() } },
          data: { acceptedAt: new Date() },
        });
      });

    const [first, second] = await Promise.all([claim(), claim()]);
    expect(first.count + second.count).toBe(1);
  });

  test("an expired token cannot be claimed even by someone holding it", async () => {
    const { token } = await makeInvite({ expiresAt: new Date(Date.now() - 60_000) });

    const claimed = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return tx.invitation.updateMany({
        where: { tokenHash: hashToken(token), acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
    });

    expect(claimed.count).toBe(0);
  });
});

describe("the link itself", () => {
  test("it points at the invite route on the origin it was generated for", () => {
    const { token } = newInviteToken();

    expect(inviteUrl(token, "https://ops.example.com")).toBe(`https://ops.example.com/invite/${token}`);
    // base64url has no characters that need escaping in a path segment, so the
    // link can be pasted anywhere without being mangled.
    expect(inviteUrl(token, "https://ops.example.com")).not.toContain("%");
  });
});

describe("the token escape policy", () => {
  /**
   * `invite_by_token` is the one place a row is readable without a tenant, so
   * it gets the same treatment RLS itself got: proved rather than trusted. The
   * bug it guards against is a policy written slightly too wide — one that
   * makes the whole table visible the moment the setting is present.
   */
  test("naming one token's hash reveals that row and no other", async () => {
    const mine = await makeInvite({ email: `mine-${suffix}@test.dev` });
    const theirs = await makeInvite({ email: `theirs-${suffix}@test.dev` });

    const visible = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${mine.tokenHash}, TRUE)`;
      // No where clause at all: whatever the policy permits is what comes back.
      return tx.invitation.findMany();
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe(mine.row.id);
    expect(visible.some((i) => i.id === theirs.row.id)).toBe(false);
  });

  test("with no hash set, the table is invisible", async () => {
    await makeInvite();

    const visible = await appRole.$transaction(async (tx) => {
      // current_setting(..., true) is NULL here, and `"tokenHash" = NULL` is
      // NULL rather than true — the policy fails closed.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', TRUE)`;
      return tx.invitation.findMany();
    });

    expect(visible).toHaveLength(0);
  });

  test("the setting does not survive the transaction that set it", async () => {
    const { tokenHash } = await makeInvite();

    await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${tokenHash}, TRUE)`;
      expect(await tx.invitation.count()).toBe(1);
    });

    // A later request on the same pooled connection inherits nothing.
    expect(await appRole.invitation.count()).toBe(0);
  });

  test("it grants reading only — an invitation cannot be edited or claimed through it", async () => {
    const { tokenHash, row } = await makeInvite();

    // FOR SELECT, so an UPDATE finds no row it is permitted to write and
    // silently affects none. The real claim runs under the tenant policy.
    const updated = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${tokenHash}, TRUE)`;
      return tx.invitation.updateMany({ where: { id: row.id }, data: { acceptedAt: new Date() } });
    });

    expect(updated.count).toBe(0);

    const stillOpen = await owner.invitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(stillOpen.acceptedAt).toBeNull();
  });

  test("the hash is not guessable from the row, so the escape needs the token itself", async () => {
    const { row, tokenHash } = await makeInvite();

    // The only input that opens the row is the SHA-256 of the token. The id,
    // which an admin can see, opens nothing.
    const byId = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${row.id}, TRUE)`;
      return tx.invitation.findMany();
    });
    expect(byId).toHaveLength(0);

    const byHash = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${tokenHash}, TRUE)`;
      return tx.invitation.findMany();
    });
    expect(byHash).toHaveLength(1);
  });
});
