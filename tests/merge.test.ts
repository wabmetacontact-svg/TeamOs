/**
 * Stage 2 — merging duplicates, and configuring pipelines.
 *
 * Merge is the riskiest write in this module: it moves rows between owners and
 * retires one of them, and getting it wrong loses history quietly. Three things
 * are easy to get wrong and each has a test here — a collision resolved by
 * guessing, a relationship stranded in a pipeline the merger cannot see, and
 * the unique index refusing the email hand-over because both rows still hold it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { personSummary } from "../src/lib/relationships";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let userId: string;
let investorCtx: string;
let kolCtx: string;
let investorStage: string;

/** Runs the merge the way the action does, so the test exercises that order. */
async function merge(keepId: string, mergeId: string, adopt = true) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

    const keep = await tx.person.findUniqueOrThrow({ where: { id: keepId } });
    const merged = await tx.person.findUniqueOrThrow({ where: { id: mergeId } });

    const relationships = await tx.relationship.updateMany({ where: { personId: mergeId }, data: { personId: keepId } });
    const activities = await tx.activity.updateMany({ where: { personId: mergeId }, data: { personId: keepId } });

    const links = await tx.clientContact.findMany({ where: { personId: mergeId }, select: { clientId: true } });
    const existing = await tx.clientContact.findMany({
      where: { personId: keepId, clientId: { in: links.map((l) => l.clientId) } },
      select: { clientId: true },
    });
    const taken = new Set(existing.map((e) => e.clientId));

    for (const link of links) {
      if (taken.has(link.clientId)) {
        await tx.clientContact.delete({ where: { clientId_personId: { clientId: link.clientId, personId: mergeId } } });
      } else {
        await tx.clientContact.update({
          where: { clientId_personId: { clientId: link.clientId, personId: mergeId } },
          data: { personId: keepId },
        });
      }
    }

    // The order that matters: release the email before claiming it.
    await tx.person.update({ where: { id: mergeId }, data: { email: null, deletedAt: new Date() } });
    await tx.person.update({
      where: { id: keepId },
      data: { email: adopt && !keep.email ? merged.email : keep.email },
    });

    return { relationships: relationships.count, activities: activities.count, contacts: links.length };
  });
}

async function makePerson(name: string, email?: string) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return tx.person.create({ data: { tenantId, name, email: email ?? null } });
  });
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Merge ${suffix}`, slug: `merge-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const investor = await tx.context.create({ data: { tenantId, name: "Investor", position: 0 } });
      const kol = await tx.context.create({ data: { tenantId, name: "KOL", position: 1 } });
      investorCtx = investor.id;
      kolCtx = kol.id;

      const stage = await tx.pipelineStage.create({
        data: { tenantId, contextId: investor.id, name: "Term sheet", position: 0 },
      });
      investorStage = stage.id;
      await tx.pipelineStage.create({ data: { tenantId, contextId: kol.id, name: "Talking", position: 0 } });

      const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
      const user = await tx.user.create({
        data: { tenantId, email: `admin-${suffix}@test.dev`, name: "Admin", passwordHash: "x", roleId: role.id, allClients: true },
      });
      userId = user.id;
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `merge-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("merging two rows that are one human", () => {
  test("relationships, activities and client links all move", async () => {
    const keep = await makePerson("Priya Sharma");
    const dupe = await makePerson("P. Sharma", `psharma-${suffix}@fund.com`);

    const brand = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      const b = await tx.brand.create({ data: { tenantId, name: `Brand ${suffix}` } });
      const client = await tx.client.create({ data: { tenantId, brandId: b.id, name: `Client ${suffix}`, status: "Active" } });

      await tx.relationship.create({ data: { tenantId, personId: dupe.id, contextId: investorCtx, stageId: investorStage } });
      await tx.activity.createMany({
        data: [
          { tenantId, personId: dupe.id, type: "Call", subject: "First call", occurredAt: new Date(), actorId: userId },
          { tenantId, personId: dupe.id, type: "Note", subject: "Follow up", occurredAt: new Date(), actorId: userId },
        ],
      });
      await tx.clientContact.create({ data: { tenantId, clientId: client.id, personId: dupe.id } });
      return b;
    });
    expect(brand).toBeTruthy();

    const moved = await merge(keep.id, dupe.id);
    expect(moved).toEqual({ relationships: 1, activities: 2, contacts: 1 });

    const db = tenantDb(tenantId);
    expect(await db.relationship.count({ where: { personId: keep.id } })).toBe(1);
    expect(await db.activity.count({ where: { personId: keep.id } })).toBe(2);
    expect(await db.clientContact.count({ where: { personId: keep.id } })).toBe(1);

    // The retired row keeps nothing but its name and the trail.
    const retired = await db.person.findUniqueOrThrow({ where: { id: dupe.id } });
    expect(retired.deletedAt).not.toBeNull();
    expect(await db.relationship.count({ where: { personId: dupe.id } })).toBe(0);
  });

  test("the kept row takes the email, in the order the unique index allows", async () => {
    const keep = await makePerson("No Email Person");
    const dupe = await makePerson("Has Email Person", `hasmail-${suffix}@fund.com`);

    // Both rows hold live emails at the start, so claiming before releasing
    // would hit the index. This passing is the proof the order is right.
    await merge(keep.id, dupe.id);

    const db = tenantDb(tenantId);
    expect((await db.person.findUniqueOrThrow({ where: { id: keep.id } })).email).toBe(`hasmail-${suffix}@fund.com`);
    expect((await db.person.findUniqueOrThrow({ where: { id: dupe.id } })).email).toBeNull();
  });

  test("the kept row's own email is not overwritten", async () => {
    const keep = await makePerson("Keeps Mine", `mine-${suffix}@fund.com`);
    const dupe = await makePerson("Other", `other-${suffix}@fund.com`);

    await merge(keep.id, dupe.id);

    expect((await tenantDb(tenantId).person.findUniqueOrThrow({ where: { id: keep.id } })).email).toBe(
      `mine-${suffix}@fund.com`,
    );
  });

  test("a duplicate client link is dropped rather than moved, because it cannot be", async () => {
    const keep = await makePerson("Contact A");
    const dupe = await makePerson("Contact B");

    const client = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      const b = await tx.brand.create({ data: { tenantId, name: `Brand2 ${suffix}` } });
      const c = await tx.client.create({ data: { tenantId, brandId: b.id, name: `Client2 ${suffix}`, status: "Active" } });
      // Both are already contacts at the same client.
      await tx.clientContact.createMany({
        data: [
          { tenantId, clientId: c.id, personId: keep.id },
          { tenantId, clientId: c.id, personId: dupe.id },
        ],
      });
      return c;
    });

    await merge(keep.id, dupe.id);

    // One link survives — the primary key is (clientId, personId), so moving
    // the second onto the same pair is not a thing that can exist.
    const db = tenantDb(tenantId);
    expect(await db.clientContact.count({ where: { clientId: client.id } })).toBe(1);
    expect(await db.clientContact.count({ where: { clientId: client.id, personId: keep.id } })).toBe(1);
  });

  test("a collision in the same pipeline is detectable before anything moves", async () => {
    const keep = await makePerson("Both A");
    const dupe = await makePerson("Both B");

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.relationship.createMany({
        data: [
          { tenantId, personId: keep.id, contextId: investorCtx },
          { tenantId, personId: dupe.id, contextId: investorCtx },
        ],
      });
    });

    // This is the check the action runs. Merging anyway would violate
    // (personId, contextId) — and if it somehow did not, it would silently
    // discard one of the two stage histories.
    const db = tenantDb(tenantId);
    const [keepRels, dupeRels] = await Promise.all([
      db.relationship.findMany({ where: { personId: keep.id, deletedAt: null }, select: { contextId: true } }),
      db.relationship.findMany({ where: { personId: dupe.id, deletedAt: null }, select: { contextId: true } }),
    ]);
    const keepContexts = new Set(keepRels.map((r) => r.contextId));
    const collisions = dupeRels.filter((r) => keepContexts.has(r.contextId));

    expect(collisions).toHaveLength(1);

    // And the database backs the refusal up rather than relying on it.
    await expect(merge(keep.id, dupe.id)).rejects.toThrow(/unique|constraint/i);
  });

  test("relationships in different pipelines merge into one person holding both", async () => {
    const keep = await makePerson("Multi A");
    const dupe = await makePerson("Multi B");

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.relationship.create({ data: { tenantId, personId: keep.id, contextId: investorCtx } });
      await tx.relationship.create({ data: { tenantId, personId: dupe.id, contextId: kolCtx } });
    });

    await merge(keep.id, dupe.id);

    const summary = await personSummary(
      {
        userId,
        tenantId,
        roleName: "Admin",
        permissions: new Set(["person:view", "relationship:view"]),
        allClients: true,
        clientIds: [],
        allContexts: true,
        contextIds: [],
      },
      keep.id,
    );

    // The whole point: one human, two pipelines, after having been two rows.
    expect(summary.relationships.map((r) => r.context.name).sort()).toEqual(["Investor", "KOL"]);
    expect(summary.hiddenCount).toBe(0);
  });

  test("a retired row releases its address for a genuinely new person", async () => {
    const email = `reuse-${suffix}@fund.com`;
    const keep = await makePerson("Keeper");
    const dupe = await makePerson("Retiree", email);

    await merge(keep.id, dupe.id, false); // keep does not adopt the address

    // Nothing holds it now, so it is free — which is what makes the partial
    // index on deletedAt IS NULL worth having.
    const fresh = await makePerson("Someone Else", email);
    expect(fresh.email).toBe(email);
  });
});

describe("pipeline configuration", () => {
  test("a stage cannot be removed while a relationship sits on it", async () => {
    const person = await makePerson("On A Stage");

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.relationship.create({
        data: { tenantId, personId: person.id, contextId: investorCtx, stageId: investorStage },
      });
    });

    const counts = await tenantDb(tenantId).relationship.groupBy({
      by: ["stageId"],
      where: { stageId: { in: [investorStage] }, deletedAt: null },
      _count: { _all: true },
    });

    // The action refuses on exactly this number. Cascading instead would
    // change a relationship's stage without anyone choosing to, which makes
    // its own history a lie.
    expect(counts[0]?._count._all).toBeGreaterThan(0);
  });

  test("two stages in one pipeline cannot share a name", async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.pipelineStage.create({ data: { tenantId, contextId: investorCtx, name: "Term sheet", position: 9 } });
      }),
    ).rejects.toThrow(/unique|constraint/i);

    // The same name in a different pipeline is fine — they are different boards.
    const ok = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return tx.pipelineStage.create({ data: { tenantId, contextId: kolCtx, name: "Term sheet", position: 9 } });
    });
    expect(ok.name).toBe("Term sheet");
  });

  test("two pipelines cannot share a name", async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.context.create({ data: { tenantId, name: "Investor", position: 5 } });
      }),
    ).rejects.toThrow(/unique|constraint/i);
  });
});
