/**
 * Per-person feature access.
 *
 * A role is the default; one person can be given a feature their role lacks,
 * or have one taken away, without a new role being invented for them. Only
 * the difference is stored.
 *
 * Three things are worth proving rather than trusting. That the arithmetic is
 * right — role, plus granted, minus revoked. That an Owner cannot be narrowed,
 * because a workspace must keep somebody who can undo anything. And that
 * nobody can hand out a feature they do not hold, because "invite someone with
 * more power than me, then sign in as them" is the oldest escalation there is.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  effectivePermissions,
  holdersOf,
  permissionOverrides,
  type PermissionKey,
} from "../src/lib/permissions";

const MEMBER = DEFAULT_ROLES.find((r) => r.name === "Member")!.permissions as PermissionKey[];
const MANAGER = DEFAULT_ROLES.find((r) => r.name === "Manager")!.permissions as PermissionKey[];

describe("what one person can do", () => {
  test("is their role, plus what was granted, minus what was taken away", () => {
    const keys = effectivePermissions("Member", MEMBER, ["expense:approve"], ["task:edit"]);

    expect(keys.has("expense:approve")).toBe(true);
    expect(keys.has("task:edit")).toBe(false);
    // Everything nobody touched still comes from the role.
    expect(keys.has("expense:create")).toBe(true);
  });

  test("an Owner is always exactly their role, whatever is stored", () => {
    const keys = effectivePermissions("Owner", ALL_PERMISSIONS, [], ["user:assign_role", "role:edit"]);
    expect(keys.size).toBe(ALL_PERMISSIONS.length);
  });
});

describe("turning ticked boxes into what is stored", () => {
  const admin = new Set<string>(ALL_PERMISSIONS);

  test("only the difference from the role is kept", () => {
    const chosen = [...MEMBER.filter((k) => k !== "task:edit"), "expense:approve"];
    const result = permissionOverrides({ roleName: "Member", roleKeys: MEMBER, chosen, granterKeys: admin });

    expect(result).toEqual({ granted: ["expense:approve"], revoked: ["task:edit"], escalations: [], unknown: [] });
  });

  test("ticking exactly the role stores nothing", () => {
    const result = permissionOverrides({ roleName: "Manager", roleKeys: MANAGER, chosen: MANAGER, granterKeys: admin });
    expect(result.granted).toEqual([]);
    expect(result.revoked).toEqual([]);
  });

  test("a role key the picker does not show is neither granted nor revoked", () => {
    // Manager holds relationship:* but the picker no longer offers it. Leaving
    // it out of the ticked set must not quietly take it away.
    const chosen = MANAGER.filter((k) => !k.startsWith("relationship:"));
    const result = permissionOverrides({ roleName: "Manager", roleKeys: MANAGER, chosen, granterKeys: admin });
    expect(result.revoked).toEqual([]);
  });

  test("granting something the granter lacks is reported as an escalation", () => {
    const manager = new Set<string>(MANAGER);
    const chosen = [...MEMBER, "expense:approve", "user:invite"];
    const result = permissionOverrides({ roleName: "Member", roleKeys: MEMBER, chosen, granterKeys: manager });

    // A Manager can approve, so passing that on is fine. They cannot invite.
    expect(result.granted).toEqual(["expense:approve", "user:invite"]);
    expect(result.escalations).toEqual(["user:invite"]);
  });

  test("taking away is never an escalation, even of something the granter lacks", () => {
    const member = new Set<string>(MEMBER);
    const chosen = MANAGER.filter((k) => k !== "client:create");
    const result = permissionOverrides({ roleName: "Manager", roleKeys: MANAGER, chosen, granterKeys: member });
    expect(result.escalations).toEqual([]);
    expect(result.revoked).toEqual(["client:create"]);
  });

  test("a key that does not exist is reported, not stored", () => {
    const result = permissionOverrides({
      roleName: "Member",
      roleKeys: MEMBER,
      chosen: [...MEMBER, "everything:all"],
      granterKeys: admin,
    });
    expect(result.unknown).toEqual(["everything:all"]);
    expect(result.granted).not.toContain("everything:all");
  });

  test("nothing is stored against an Owner", () => {
    const result = permissionOverrides({ roleName: "Owner", roleKeys: ALL_PERMISSIONS, chosen: [], granterKeys: admin });
    expect(result).toMatchObject({ granted: [], revoked: [] });
  });
});

// ─────────────────────────────────────── the same rule, in the database ───

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
let tenantId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Overrides ${suffix}`, slug: `overrides-${suffix}` } });
  tenantId = tenant.id;
  const permissions = await owner.permission.findMany();
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const roles: Record<string, string> = {};
      for (const def of DEFAULT_ROLES.filter((r) => ["Owner", "Manager", "Member"].includes(r.name))) {
        const role = await tx.role.create({ data: { tenantId, name: def.name } });
        roles[def.name] = role.id;
        const keys = def.permissions === "all" ? ALL_PERMISSIONS : def.permissions;
        await tx.rolePermission.createMany({
          data: keys.map((key) => ({ tenantId, roleId: role.id, permissionId: idByKey.get(key)! })),
        });
      }

      const people: [string, string, string[], string[]][] = [
        // A Member who was given approving.
        ["memberApprover", "Member", ["expense:approve"], []],
        // A plain Member.
        ["member", "Member", [], []],
        // A Manager whose approving was taken away.
        ["managerNoApprove", "Manager", [], ["expense:approve"]],
        // A plain Manager.
        ["manager", "Manager", [], []],
        // An Owner with a revocation that must not bite.
        ["owner", "Owner", [], ["expense:approve"]],
      ];
      for (const [key, role, granted, revoked] of people) {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: `${key.toLowerCase()}-${suffix}@test.dev`,
            name: key,
            passwordHash: "x",
            roleId: roles[role]!,
            permissionsGranted: granted,
            permissionsRevoked: revoked,
          },
        });
        ids[key] = user.id;
      }
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `overrides-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("finding everyone who can do something", () => {
  test("counts a personal grant, drops a personal revocation, and never narrows an Owner", async () => {
    // This is who hears about an entry waiting for approval. A Member given
    // approving who is never told there is anything to approve has been given
    // nothing.
    const approvers = await tenantDb(tenantId).user.findMany({
      where: { status: "Active", ...holdersOf("expense:approve") },
      select: { id: true },
    });
    const found = new Set(approvers.map((u) => u.id));

    expect(found.has(ids.memberApprover!)).toBe(true);
    expect(found.has(ids.manager!)).toBe(true);
    expect(found.has(ids.owner!)).toBe(true);

    expect(found.has(ids.member!)).toBe(false);
    expect(found.has(ids.managerNoApprove!)).toBe(false);
  });
});
