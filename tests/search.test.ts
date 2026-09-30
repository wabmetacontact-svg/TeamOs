/**
 * Stage 6 — cross-entity search.
 *
 * Search is the single easiest place in an application like this to leak,
 * because "look in every table for this word" is exactly what somebody writes,
 * and the leak is invisible unless a test types a hidden record's name into
 * the box.
 *
 * So that is what these do: take the names of things one user can see and
 * another cannot, and search for them as the wrong person.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { searchEverything } from "../src/lib/search";
import { dueDateFrom } from "../src/lib/task-rules";
import type { Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let alice: string;
let bob: string;
let visibleClient: string;
let hiddenClient: string;
let investorCtx: string;
let kolCtx: string;

/** Sees everything. */
function admin(): Scope {
  return {
    userId: alice,
    tenantId,
    roleName: "Admin",
    permissions: new Set<string>(),
    allClients: true,
    clientIds: [],
    allContexts: true,
    contextIds: [],
  };
}

/** One client, one pipeline. */
function narrow(): Scope {
  return {
    ...admin(),
    userId: bob,
    roleName: "Manager",
    allClients: false,
    clientIds: [visibleClient],
    allContexts: false,
    contextIds: [kolCtx],
  };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Search ${suffix}`, slug: `search-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
    const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });

    const a = await tx.user.create({
      data: { tenantId, email: `a-${suffix}@test.dev`, name: "Alice", passwordHash: "x", roleId: role.id, allClients: true },
    });
    const b = await tx.user.create({
      data: { tenantId, email: `b-${suffix}@test.dev`, name: "Bob", passwordHash: "x", roleId: role.id },
    });
    alice = a.id;
    bob = b.id;

    const [visible, hidden] = await Promise.all([
      tx.client.create({ data: { tenantId, brandId: brand.id, name: `Marigold ${suffix}`, status: "Active" } }),
      tx.client.create({ data: { tenantId, brandId: brand.id, name: `Saffron ${suffix}`, status: "Active" } }),
    ]);
    visibleClient = visible.id;
    hiddenClient = hidden.id;

    const investor = await tx.context.create({ data: { tenantId, name: "Investor", position: 0 } });
    const kol = await tx.context.create({ data: { tenantId, name: "KOL", position: 1 } });
    investorCtx = investor.id;
    kolCtx = kol.id;

    const person = await tx.person.create({
      data: { tenantId, name: `Priya ${suffix}`, email: `priya-${suffix}@fund.test` },
    });

    await tx.relationship.createMany({
      data: [
        { tenantId, personId: person.id, contextId: investor.id, notes: `Cheque discussion ${suffix}` },
        { tenantId, personId: person.id, contextId: kol.id, notes: `Content brief ${suffix}` },
      ],
    });

    await tx.transaction.createMany({
      data: [
        {
          tenantId,
          ref: `TX-${suffix}-VIS`,
          direction: "OUT",
          clientId: visible.id,
          bookMonth: "2026-04",
          date: new Date("2026-04-15T00:00:00Z"),
          name: `Rosewood desk ${suffix}`,
          amountOriginal: 100n,
          amountBase: 100n,
          approvalState: "Approved",
          createdById: a.id,
        },
        {
          tenantId,
          ref: `TX-${suffix}-HID`,
          direction: "OUT",
          clientId: hidden.id,
          bookMonth: "2026-04",
          date: new Date("2026-04-15T00:00:00Z"),
          name: `Ebony cabinet ${suffix}`,
          amountOriginal: 100n,
          amountBase: 100n,
          approvalState: "Approved",
          createdById: a.id,
        },
      ],
    });

    await tx.task.createMany({
      data: [
        {
          tenantId,
          name: `Lacquer report ${suffix}`,
          assigneeId: a.id,
          assignedById: a.id,
          clientId: hidden.id,
          dueDate: dueDateFrom("2026-04-20", "UTC"),
          estimatedMinutes: 30,
        },
        {
          tenantId,
          name: `Velvet deck ${suffix}`,
          assigneeId: a.id,
          assignedById: a.id,
          dueDate: dueDateFrom("2026-04-20", "UTC"),
          estimatedMinutes: 30,
          isPrivate: true,
        },
        {
          tenantId,
          name: `Copper audit ${suffix}`,
          assigneeId: b.id,
          assignedById: a.id,
          clientId: visible.id,
          dueDate: dueDateFrom("2026-04-20", "UTC"),
          estimatedMinutes: 30,
        },
      ],
    });
  });
}, 120_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `search-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("it finds things", () => {
  test("a client by name", async () => {
    const results = await searchEverything(admin(), "Marigold");
    expect(results.hits.some((h) => h.type === "client" && h.id === visibleClient)).toBe(true);
  });

  test("a transaction by payee, and by reference", async () => {
    expect((await searchEverything(admin(), "Rosewood")).hits.some((h) => h.type === "transaction")).toBe(true);
    expect((await searchEverything(admin(), `TX-${suffix}-VIS`)).hits.some((h) => h.type === "transaction")).toBe(true);
  });

  test("a person and a task", async () => {
    const person = await searchEverything(admin(), "Priya");
    // One human, one hit — however many pipelines the old data put them in.
    expect(person.hits.filter((h) => h.type === "person")).toHaveLength(1);

    expect((await searchEverything(admin(), "Copper")).hits.some((h) => h.type === "task")).toBe(true);
  });

  test("one character finds nothing, because it would find everything", async () => {
    const results = await searchEverything(admin(), "a");
    expect(results.hits).toEqual([]);
    expect(await searchEverything(admin(), "")).toMatchObject({ hits: [] });
  });

  test("every hit carries somewhere to go", async () => {
    const results = await searchEverything(admin(), suffix);

    expect(results.hits.length).toBeGreaterThan(3);
    for (const hit of results.hits) {
      expect({ type: hit.type, href: hit.href.startsWith("/") }).toEqual({ type: hit.type, href: true });
      expect(hit.title.length).toBeGreaterThan(0);
    }
  });
});

describe("it cannot be used to find what you may not see", () => {
  test("a client outside the scope, searched for by its exact name", async () => {
    // The obvious probe, and the one that catches a search written without a
    // scope: type the thing you are not allowed to see.
    const results = await searchEverything(narrow(), "Saffron");

    expect(results.hits).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(hiddenClient);
  });

  test("a transaction on a hidden client", async () => {
    expect((await searchEverything(narrow(), "Ebony")).hits).toEqual([]);
    // And the one on their own client is still found, so this is scope rather
    // than a broken query.
    expect((await searchEverything(narrow(), "Rosewood")).hits.some((h) => h.type === "transaction")).toBe(true);
  });

  test("a task on a hidden client", async () => {
    expect((await searchEverything(narrow(), "Lacquer")).hits).toEqual([]);
    expect((await searchEverything(narrow(), "Copper")).hits.some((h) => h.type === "task")).toBe(true);
  });

  test("somebody else's private task", async () => {
    // Alice's private task has no client at all, so the client filter does not
    // hide it — only the privacy filter does. That is the case a search
    // written from the client rules alone would get wrong.
    expect((await searchEverything(narrow(), "Velvet")).hits).toEqual([]);
    expect((await searchEverything(admin(), "Velvet")).hits.some((h) => h.type === "task")).toBe(true);
  });

  test("a person held in a pipeline outside the scope says nothing about it", async () => {
    const results = await searchEverything(narrow(), "Priya");

    // The person is not secret — people never are. The pipeline is.
    expect(results.hits.some((h) => h.type === "person")).toBe(true);
    expect(JSON.stringify(results)).not.toContain(investorCtx);
  });

  test("relationship notes are no longer searched at all", async () => {
    // The Pipelines screens are gone; their rows remain in the database, and
    // search must not become the one door still open onto them.
    expect((await searchEverything(narrow(), "Cheque discussion")).hits).toEqual([]);
    expect((await searchEverything(admin(), "Cheque discussion")).hits).toEqual([]);
  });

  test("a user with nothing granted finds nothing but people", async () => {
    const stranded: Scope = { ...narrow(), clientIds: [], contextIds: [] };
    const results = await searchEverything(stranded, suffix);

    // Clients and transactions: all gone. People remain, because
    // the directory is deliberately workspace-wide — the banner is what keeps
    // that honest, not hiding the person.
    expect(results.counts.client).toBe(0);
    expect(results.counts.transaction).toBe(0);
  });
});
