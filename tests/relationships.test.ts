/**
 * Stage 2 acceptance gate — relationships.
 *
 * The plan asks for two things:
 *
 *   "One person holds an Investor and a KOL relationship simultaneously, each
 *    with its own owner and stage. A user scoped out of Investor sees the
 *    banner and cannot retrieve the underlying record through any route."
 *
 * The first is what three spreadsheets could not express. The second is the
 * harder one, because the obvious implementations are both wrong: hiding the
 * relationship entirely means two people approach the same investor a week
 * apart, and showing it leaks the deal. The banner is the narrow path between
 * them, and these tests pin down exactly how narrow.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import {
  findPersonByEmail,
  getRelationship,
  listContexts,
  listPeople,
  listRelationships,
  personSummary,
  pipelineSummary,
} from "../src/lib/relationships";
import { assertContextInScope, canSeeContext, NotFoundError, type Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let investorCtx: string;
let kolCtx: string;
let investorStage: string;
let kolStage: string;
let kolTerminal: string;
let priyaId: string;
let investorRel: string;
let kolRel: string;
let scoutId: string;
let partnerId: string;

/** Sees every pipeline. */
function everyone(): Scope {
  return {
    userId: scoutId,
    tenantId,
    roleName: "Admin",
    permissions: new Set(["relationship:view", "relationship:edit", "person:view"]),
    allClients: true,
    clientIds: [],
    allContexts: true,
    contextIds: [],
  };
}

/** Runs the KOL pipeline and has no business in the investor one. */
function kolOnly(): Scope {
  return { ...everyone(), userId: partnerId, roleName: "Manager", allContexts: false, contextIds: [kolCtx] };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Rel ${suffix}`, slug: `rel-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const investor = await tx.context.create({ data: { tenantId, name: "Investor", position: 0 } });
      const kol = await tx.context.create({ data: { tenantId, name: "KOL", position: 1 } });
      investorCtx = investor.id;
      kolCtx = kol.id;

      const [s1, s2, s3] = await Promise.all([
        tx.pipelineStage.create({ data: { tenantId, contextId: investor.id, name: "Term sheet", position: 1 } }),
        tx.pipelineStage.create({ data: { tenantId, contextId: kol.id, name: "Negotiating", position: 1 } }),
        tx.pipelineStage.create({ data: { tenantId, contextId: kol.id, name: "Signed", position: 2, isTerminal: true } }),
      ]);
      investorStage = s1.id;
      kolStage = s2.id;
      kolTerminal = s3.id;

      const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
      const scout = await tx.user.create({
        data: { tenantId, email: `scout-${suffix}@test.dev`, name: "Scout", passwordHash: "x", roleId: role.id, allClients: true },
      });
      const partner = await tx.user.create({
        data: {
          tenantId,
          email: `partner-${suffix}@test.dev`,
          name: "Partner",
          passwordHash: "x",
          roleId: role.id,
          allClients: true,
          allContexts: false,
        },
      });
      scoutId = scout.id;
      partnerId = partner.id;
      await tx.userContextScope.create({ data: { tenantId, userId: partner.id, contextId: kol.id } });

      // The same human, in two pipelines at once.
      const priya = await tx.person.create({
        data: { tenantId, name: "Priya Sharma", email: `priya-${suffix}@fund.com`, notes: "Angel, ex-operator" },
      });
      priyaId = priya.id;

      const rel1 = await tx.relationship.create({
        data: {
          tenantId,
          personId: priya.id,
          contextId: investor.id,
          stageId: s1.id,
          ownerId: scout.id,
          value: 5_000_000_00n,
          notes: "Leading the seed",
        },
      });
      const rel2 = await tx.relationship.create({
        data: { tenantId, personId: priya.id, contextId: kol.id, stageId: s2.id, ownerId: partner.id },
      });
      investorRel = rel1.id;
      kolRel = rel2.id;

      await tx.activity.createMany({
        data: [
          { tenantId, personId: priya.id, relationshipId: rel1.id, type: "Meeting", subject: "Seed terms discussed", occurredAt: new Date(), actorId: scout.id },
          { tenantId, personId: priya.id, relationshipId: rel2.id, type: "Message", subject: "Content brief sent", occurredAt: new Date(), actorId: partner.id },
          { tenantId, personId: priya.id, type: "Note", subject: "Prefers WhatsApp", occurredAt: new Date(), actorId: scout.id },
        ],
      });

      // A second person, in the investor pipeline only.
      const raj = await tx.person.create({ data: { tenantId, name: "Raj Mehta", email: `raj-${suffix}@fund.com` } });
      await tx.relationship.create({
        data: { tenantId, personId: raj.id, contextId: investor.id, stageId: s1.id, ownerId: scout.id },
      });
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `rel-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("one person, two relationships", () => {
  test("the same human holds both at once, each with its own owner and stage", async () => {
    const { person, relationships } = await personSummary(everyone(), priyaId);

    expect(person.name).toBe("Priya Sharma");
    expect(relationships).toHaveLength(2);

    const byContext = new Map(relationships.map((r) => [r.context.name, r]));
    expect(byContext.get("Investor")?.owner?.name).toBe("Scout");
    expect(byContext.get("Investor")?.stage?.name).toBe("Term sheet");
    expect(byContext.get("KOL")?.owner?.name).toBe("Partner");
    expect(byContext.get("KOL")?.stage?.name).toBe("Negotiating");

    // Different owners, different stages, one person — the thing three
    // spreadsheets could not say.
    expect(byContext.get("Investor")?.ownerId).not.toBe(byContext.get("KOL")?.ownerId);
  });

  test("a second relationship in the same pipeline is refused by the database", async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.relationship.create({ data: { tenantId, personId: priyaId, contextId: investorCtx } });
      }),
    ).rejects.toThrow(/unique|constraint/i);
  });
});

describe("the awareness banner", () => {
  test("someone scoped out of Investor still knows a relationship is there — and nothing more", async () => {
    const summary = await personSummary(kolOnly(), priyaId);

    // They can see the person, and the one relationship they run.
    expect(summary.person.name).toBe("Priya Sharma");
    expect(summary.relationships).toHaveLength(1);
    expect(summary.relationships[0]!.context.name).toBe("KOL");

    // And they are told one more exists. That is the whole banner.
    expect(summary.hiddenCount).toBe(1);

    // What must not come back with it: which pipeline, who owns it, what stage
    // it is at, what it is worth, or what was said. The count is the payload.
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain("Investor");
    expect(serialised).not.toContain("Term sheet");
    expect(serialised).not.toContain("Seed terms discussed");
    expect(serialised).not.toContain("Leading the seed");
    expect(serialised).not.toContain(investorRel);
    expect(serialised).not.toContain("500000000"); // the cheque size
  });

  test("the count is zero when nothing is hidden, so the banner does not cry wolf", async () => {
    const summary = await personSummary(everyone(), priyaId);
    expect(summary.hiddenCount).toBe(0);
  });

  test("a plain note about the person is shared; one tied to a hidden pipeline is not", async () => {
    const { activities } = await personSummary(kolOnly(), priyaId);
    const subjects = activities.map((a) => a.subject);

    expect(subjects).toContain("Prefers WhatsApp"); // no relationship — about the person
    expect(subjects).toContain("Content brief sent"); // their own pipeline
    expect(subjects).not.toContain("Seed terms discussed"); // the one they may not read
  });

  test("the directory row carries the same count, without naming anything", async () => {
    const people = await listPeople(kolOnly(), { q: "Priya" });

    expect(people).toHaveLength(1);
    expect(people[0]!.hiddenCount).toBe(1);
    expect(people[0]!.relationships).toHaveLength(1);
    expect(JSON.stringify(people[0])).not.toContain("Investor");
  });
});

describe("no route into a pipeline you are scoped out of", () => {
  test("fetching the relationship by id is a 404, identical to one that never existed", async () => {
    await expect(getRelationship(kolOnly(), investorRel)).rejects.toThrow(NotFoundError);

    let outOfScope = "";
    let neverExisted = "";
    await getRelationship(kolOnly(), investorRel).catch((e: Error) => (outOfScope = e.message));
    await getRelationship(kolOnly(), "clnonexistent00000000").catch((e: Error) => (neverExisted = e.message));
    expect(outOfScope).toBe(neverExisted);

    // The one they do run opens normally, so this is scope and not a break.
    await expect(getRelationship(kolOnly(), kolRel)).resolves.toBeTruthy();
  });

  test("the list never includes it, however it is filtered", async () => {
    const scoped = kolOnly();

    expect((await listRelationships(scoped)).map((r) => r.id)).toEqual([kolRel]);
    // Asking for the hidden pipeline by name returns nothing rather than
    // everything, which is the failure mode when a filter replaces a scope.
    expect(await listRelationships(scoped, { contextId: investorCtx })).toHaveLength(0);
    expect(await listRelationships(scoped, { stageId: investorStage })).toHaveLength(0);
    expect(await listRelationships(scoped, { ownerId: scoutId })).toHaveLength(0);
    expect(await listRelationships(scoped, { q: "Priya" })).toHaveLength(1);
  });

  test("searching the directory by the hidden person's own name does not open the pipeline", async () => {
    // Raj exists only in Investor. Someone scoped to KOL may find the person —
    // people are not secret — but gets no relationship with them.
    const people = await listPeople(kolOnly(), { q: "Raj" });

    expect(people).toHaveLength(1);
    expect(people[0]!.name).toBe("Raj Mehta");
    expect(people[0]!.relationships).toHaveLength(0);
    expect(people[0]!.hiddenCount).toBe(1);
  });

  test("the pipeline itself is not listed, and its summary refuses", async () => {
    const contexts = await listContexts(kolOnly());
    expect(contexts.map((c) => c.name)).toEqual(["KOL"]);

    await expect(pipelineSummary(kolOnly(), investorCtx)).rejects.toThrow(NotFoundError);
    await expect(pipelineSummary(kolOnly(), kolCtx)).resolves.toBeTruthy();
  });

  test("the guards say the same thing the queries do", () => {
    expect(canSeeContext(kolOnly(), kolCtx)).toBe(true);
    expect(canSeeContext(kolOnly(), investorCtx)).toBe(false);
    expect(canSeeContext(everyone(), investorCtx)).toBe(true);

    expect(() => assertContextInScope(kolOnly(), investorCtx)).toThrow(NotFoundError);
    expect(() => assertContextInScope(kolOnly(), kolCtx)).not.toThrow();
    // Nothing to check is not a failure.
    expect(() => assertContextInScope(kolOnly(), null)).not.toThrow();
  });

  test("a user granted no pipelines at all sees no relationships, not all of them", async () => {
    const stranded: Scope = { ...kolOnly(), contextIds: [] };

    expect(await listRelationships(stranded)).toHaveLength(0);
    expect(await listContexts(stranded)).toHaveLength(0);
    expect((await personSummary(stranded, priyaId)).hiddenCount).toBe(2);
    await expect(getRelationship(stranded, kolRel)).rejects.toThrow(NotFoundError);
  });
});

describe("the pipeline board", () => {
  test("counts and cheque sizes are summed per stage, within scope", async () => {
    const summary = await pipelineSummary(everyone(), investorCtx);

    const termSheet = summary.stages.find((s) => s.id === investorStage)!;
    expect(termSheet.count).toBe(2); // Priya and Raj
    expect(termSheet.value).toBe(5_000_000_00n); // only Priya's is known
  });

  test("terminal stages are out of the working list unless asked for", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.relationship.update({ where: { id: kolRel }, data: { stageId: kolTerminal } });
    });

    // A signed KOL is done; it should not sit in the board clamouring for
    // attention alongside live ones.
    expect(await listRelationships(kolOnly())).toHaveLength(0);
    expect(await listRelationships(kolOnly(), { includeTerminal: true })).toHaveLength(1);
    // Asking for that stage by name is asking for it explicitly.
    expect(await listRelationships(kolOnly(), { stageId: kolTerminal })).toHaveLength(1);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.relationship.update({ where: { id: kolRel }, data: { stageId: kolStage } });
    });
  });
});

describe("people are one row per human", () => {
  test("the same address cannot be entered twice, whatever the casing", async () => {
    const email = `dupe-${suffix}@fund.com`;

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.person.create({ data: { tenantId, name: "First Entry", email } });
    });

    // The index is on lower(email), so this is the same person as far as the
    // database is concerned — which is the point, because it is the same human.
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.person.create({ data: { tenantId, name: "Second Entry", email: email.toUpperCase() } });
      }),
    ).rejects.toThrow(/unique|constraint/i);
  });

  test("the lookup finds them the same way the index does", async () => {
    const found = await findPersonByEmail(everyone(), `PRIYA-${suffix}@FUND.COM`.toUpperCase());
    expect(found?.id).toBe(priyaId);

    expect(await findPersonByEmail(everyone(), "nobody@example.com")).toBeNull();
    expect(await findPersonByEmail(everyone(), "   ")).toBeNull();
  });

  test("people without an email do not collide with each other", async () => {
    // NULLs do not conflict in Postgres, and the partial index makes that
    // explicit rather than incidental. Two unnamed contacts are two people.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.person.createMany({
        data: [
          { tenantId, name: "No Email One" },
          { tenantId, name: "No Email Two" },
        ],
      });
    });

    expect(await tenantDb(tenantId).person.count({ where: { email: null } })).toBeGreaterThanOrEqual(2);
  });

  test("a soft-deleted person releases their address for re-use", async () => {
    const email = `recycled-${suffix}@fund.com`;

    const first = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return tx.person.create({ data: { tenantId, name: "Gone", email } });
    });

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.person.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
      // The index is partial on deletedAt IS NULL, so this is now free.
      await tx.person.create({ data: { tenantId, name: "Again", email } });
    });

    expect((await findPersonByEmail(everyone(), email))?.name).toBe("Again");
  });
});
