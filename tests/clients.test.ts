/**
 * Stage 1 acceptance gate — clients.
 *
 * The plan asks for one thing above all: "a Manager scoped to two clients
 * cannot retrieve a third through the list endpoint, a direct ID fetch, search,
 * or an export — four routes, same denial." Four routes is the point. A scope
 * check that holds on the screen and leaks through the CSV is not a scope
 * check, and an export is exactly where that happens, because nobody reads its
 * output row by row.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import {
  clientDependencies,
  clientHistory,
  exportClients,
  getClient,
  listClients,
  searchClients,
} from "../src/lib/clients";
import { readFieldDefs, validateCustomFields } from "../src/lib/custom-fields";
import { NotFoundError, type Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let brandId: string;
let otherBrandId: string;
let userId: string;
/** Assigned, assigned, and deliberately not. */
let clientA: string;
let clientB: string;
let clientC: string;

/** A Manager who can see exactly two of the three clients. */
function manager(): Scope {
  return {
    userId,
    tenantId,
    roleName: "Manager",
    permissions: new Set(["client:view", "client:create", "client:edit", "client:archive", "client:delete"]),
    allClients: false,
    clientIds: [clientA, clientB],
    allContexts: true,
    contextIds: [],
  };
}

/** Somebody who sees everything, for contrast. */
function admin(): Scope {
  return { ...manager(), roleName: "Admin", allClients: true, clientIds: [] };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Clients ${suffix}`, slug: `clients-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const brand = await tx.brand.create({
        data: {
          tenantId,
          name: "ARC3",
          fieldDefs: [
            { key: "contract_end", label: "Contract ends", type: "date", required: false },
            { key: "tier", label: "Tier", type: "select", required: true, options: ["Gold", "Silver"] },
          ],
        },
      });
      brandId = brand.id;

      const other = await tx.brand.create({ data: { tenantId, name: "LineUp" } });
      otherBrandId = other.id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager", description: "Test" } });
      const user = await tx.user.create({
        data: { tenantId, email: `mgr-${suffix}@test.dev`, name: "Manager", passwordHash: "x", roleId: role.id },
      });
      userId = user.id;

      const mk = (name: string, subTag: string | null, status = "Active") =>
        tx.client.create({ data: { tenantId, brandId: brand.id, name, subTag, status, billingCurrency: "INR" } });

      const [a, b, c] = await Promise.all([
        mk("Alpha Industries", "Internal"),
        mk("Beta Traders", "Jay"),
        mk("Gamma Secret", "Confidential"),
      ]);
      clientA = a.id;
      clientB = b.id;
      clientC = c.id;

      await tx.userClientScope.createMany({
        data: [a, b].map((c2) => ({ tenantId, userId: user.id, clientId: c2.id })),
      });
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `clients-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("four routes, same denial", () => {
  test("the tenant really does hold all three, so absence means scope and not an empty table", async () => {
    expect(await tenantDb(tenantId).client.count()).toBe(3);
    expect((await listClients(admin())).map((c) => c.id).sort()).toEqual([clientA, clientB, clientC].sort());
  });

  test("route one — the list shows two of three", async () => {
    const ids = (await listClients(manager())).map((c) => c.id);

    expect(ids.sort()).toEqual([clientA, clientB].sort());
    expect(ids).not.toContain(clientC);
  });

  test("route two — search cannot reach it, even by its exact name", async () => {
    // Search narrows what scope allowed; it must never widen it. Typing the
    // client's real name is the obvious way to find out whether it does.
    expect(await searchClients(manager(), "Gamma Secret")).toHaveLength(0);
    expect(await searchClients(manager(), "Confidential")).toHaveLength(0);
    expect(await searchClients(manager(), "Gamma")).toHaveLength(0);

    // The same search run by someone who may see it, so the test proves scope
    // and not a broken query.
    expect(await searchClients(admin(), "Gamma Secret")).toHaveLength(1);

    // And it still finds what the Manager may see.
    expect((await searchClients(manager(), "alpha")).map((c) => c.id)).toEqual([clientA]);
  });

  test("route three — fetching it by id is a 404, identical to one that never existed", async () => {
    let outOfScope = "";
    let neverExisted = "";

    await expect(getClient(manager(), clientC)).rejects.toThrow(NotFoundError);
    await getClient(manager(), clientC).catch((e: Error) => (outOfScope = e.message));
    await getClient(manager(), "clnonexistent000000000").catch((e: Error) => (neverExisted = e.message));

    // Byte-identical: the id of a client you may not see cannot be confirmed by
    // watching how the failure differs.
    expect(outOfScope).toBe(neverExisted);
    await expect(getClient(manager(), clientA)).resolves.toBeTruthy();
  });

  test("route four — the export carries two rows, not three", async () => {
    const rows = await exportClients(manager());

    expect(rows.map((c) => c.id).sort()).toEqual([clientA, clientB].sort());
    // The whole serialised file, not just the ids — a leak through a joined
    // field would not show up in an id comparison.
    expect(JSON.stringify(rows)).not.toContain("Gamma Secret");
    expect(JSON.stringify(rows)).not.toContain(clientC);
  });

  test("filters cannot be used to climb out of scope", async () => {
    // Asking for the brand, the status or the archive flag that the hidden
    // client has must not produce it. Each of these is an AND onto the scope
    // filter, never a replacement for it.
    expect(await listClients(manager(), { brandId })).toHaveLength(2);
    expect(await listClients(manager(), { status: "Active" })).toHaveLength(2);
    expect(await listClients(manager(), { includeArchived: true })).toHaveLength(2);
    expect(await listClients(manager(), { q: "Gamma", brandId, status: "Active", includeArchived: true })).toHaveLength(0);
  });

  test("a caller's own condition cannot overwrite the scope filter", async () => {
    /**
     * This is a regression test with a story. The first version of clientWhere
     * spread the caller's conditions over the scope filter:
     *
     *   { ...clientIdScope(scope), deletedAt: null, ...extra }
     *
     * `clientIdScope` produces `{ id: { in: [...] } }`. A fetch by id passes
     * `{ id }`. Spreading the second over the first replaced the scope's `id`
     * key outright, so getClient returned any client in the tenant — while the
     * list, the search and the export all stayed correct, because none of them
     * passes an `id`. Three routes green, one route wide open.
     *
     * The fix was to nest the scope filter inside AND, where a caller's
     * condition has no key to collide with. These assertions fail if anyone
     * ever flattens it back.
     */
    await expect(getClient(manager(), clientC)).rejects.toThrow(NotFoundError);

    // The same collision, reached through every other route that takes an id.
    await expect(clientDependencies(manager(), clientC)).rejects.toThrow(NotFoundError);
    await expect(clientHistory(manager(), clientC)).rejects.toThrow(NotFoundError);

    // And a filter whose key the scope filter also uses, for the same reason.
    expect(await listClients(manager(), { status: "Active", brandId })).toHaveLength(2);
  });

  test("a user with no assignments at all reaches nothing, rather than everything", async () => {
    const stranded: Scope = { ...manager(), clientIds: [] };

    expect(await listClients(stranded)).toHaveLength(0);
    expect(await searchClients(stranded, "a")).toHaveLength(0);
    expect(await exportClients(stranded)).toHaveLength(0);
    await expect(getClient(stranded, clientA)).rejects.toThrow(NotFoundError);
  });

  test("the derived reads refuse an out-of-scope client too", async () => {
    // These take an id and go on to count or list other tables, which is
    // exactly the shape that forgets to check.
    await expect(clientDependencies(manager(), clientC)).rejects.toThrow(NotFoundError);
    await expect(clientHistory(manager(), clientC)).rejects.toThrow(NotFoundError);

    await expect(clientDependencies(manager(), clientA)).resolves.toBeTruthy();
  });
});

describe("deleting and archiving", () => {
  test("a client with financial records reports what is in the way", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.transaction.create({
        data: {
          tenantId,
          ref: `TX-${suffix}-A`,
          direction: "OUT",
          clientId: clientA,
          bookMonth: "2026-09",
          date: new Date(),
          name: "Retainer",
          amountOriginal: 50_000n,
          amountBase: 50_000n,
          createdById: userId,
        },
      });
    });

    const { counts, total } = await clientDependencies(manager(), clientA);
    expect(counts.transactions).toBe(1);
    expect(total).toBeGreaterThan(0); // deleteClient refuses on exactly this
  });

  test("a client with nothing attached reports nothing in the way", async () => {
    const { total } = await clientDependencies(manager(), clientB);
    expect(total).toBe(0);
  });

  test("archiving keeps the record and everything hanging off it", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.update({ where: { id: clientB }, data: { status: "Archived" } });
    });

    // Out of the working list…
    expect((await listClients(manager())).map((c) => c.id)).toEqual([clientA]);
    // …but not gone, and still reachable when asked for.
    expect((await listClients(manager(), { includeArchived: true })).map((c) => c.id).sort()).toEqual(
      [clientA, clientB].sort(),
    );
    await expect(getClient(manager(), clientB)).resolves.toMatchObject({ status: "Archived" });

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.update({ where: { id: clientB }, data: { status: "Active" } });
    });
  });

  test("a soft-deleted client disappears from all four routes at once", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.update({ where: { id: clientB }, data: { deletedAt: new Date() } });
    });

    // deletedAt lives in clientWhere, so one filter covers every route rather
    // than four filters that could drift apart.
    expect((await listClients(manager(), { includeArchived: true })).map((c) => c.id)).toEqual([clientA]);
    expect(await searchClients(manager(), "Beta")).toHaveLength(0);
    expect(await exportClients(manager(), { includeArchived: true })).toHaveLength(1);
    await expect(getClient(manager(), clientB)).rejects.toThrow(NotFoundError);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.update({ where: { id: clientB }, data: { deletedAt: null } });
    });
  });
});

describe("custom fields", () => {
  const defs = readFieldDefs([
    { key: "contract_end", label: "Contract ends", type: "date", required: false },
    { key: "tier", label: "Tier", type: "select", required: true, options: ["Gold", "Silver"] },
    { key: "channels", label: "Channels", type: "multiselect", required: false, options: ["X", "YouTube"] },
    { key: "seats", label: "Seats", type: "number", required: false },
    { key: "site", label: "Website", type: "url", required: false },
  ]);

  test("the brand's definitions are what a value is checked against", () => {
    const { values, errors } = validateCustomFields(defs, {
      contract_end: "2027-03-31",
      tier: "Gold",
      channels: ["X", "YouTube"],
      seats: "1,200",
      site: "arc3.studio",
    });

    expect(errors).toEqual({});
    expect(values.contract_end).toBe("2027-03-31");
    expect(values.tier).toBe("Gold");
    expect(values.channels).toEqual(["X", "YouTube"]);
    expect(values.seats).toBe(1200); // a typed number, not the string typed in
    expect(values.site).toBe("https://arc3.studio/"); // scheme added rather than refused
  });

  test("a value outside the brand's choices is refused, not quietly stored", () => {
    const { errors } = validateCustomFields(defs, { tier: "Platinum", channels: ["X", "TikTok"] });

    expect(errors["customFields.tier"]).toBeDefined();
    expect(errors["customFields.channels"]?.[0]).toContain("TikTok");
  });

  test("a required field left empty is reported; an optional one becomes null", () => {
    const { values, errors } = validateCustomFields(defs, { contract_end: "" });

    expect(errors["customFields.tier"]).toEqual(["Tier is required"]);
    // null rather than omitted, so "never filled in" and "cleared" read alike.
    expect(values.contract_end).toBeNull();
  });

  test("a field the brand does not define is dropped", () => {
    const { values } = validateCustomFields(defs, { tier: "Gold", secret_margin: "0.42" });

    expect(values.secret_margin).toBeUndefined();
    expect(Object.keys(values).sort()).toEqual(["channels", "contract_end", "seats", "site", "tier"]);
  });

  test("every problem comes back at once, not one per submission", () => {
    const { errors } = validateCustomFields(defs, { tier: "Bronze", seats: "many", site: "not a url", contract_end: "31/03/2027" });

    expect(Object.keys(errors).sort()).toEqual([
      "customFields.contract_end",
      "customFields.seats",
      "customFields.site",
      "customFields.tier",
    ]);
  });

  test("a malformed definition list degrades to no fields rather than crashing the page", () => {
    expect(readFieldDefs(null)).toEqual([]);
    expect(readFieldDefs("nonsense")).toEqual([]);
    expect(readFieldDefs([{ key: "Bad Key", label: "x", type: "text" }])).toEqual([]);
    // A choice field with no choices is unusable, so the whole list is refused
    // rather than half-applied.
    expect(readFieldDefs([{ key: "tier", label: "Tier", type: "select" }])).toEqual([]);
  });

  test("two fields cannot share a key", () => {
    expect(
      readFieldDefs([
        { key: "tier", label: "Tier", type: "text" },
        { key: "tier", label: "Level", type: "text" },
      ]),
    ).toEqual([]);
  });
});

describe("assignment grants scope", () => {
  test("granting a client widens exactly one person's reach, by one", async () => {
    const before = manager();
    expect(before.clientIds).not.toContain(clientC);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.userClientScope.create({ data: { tenantId, userId, clientId: clientC } });
    });

    // Scope is read from the database on every request, so the next one sees it.
    const grants = await tenantDb(tenantId).userClientScope.findMany({ where: { userId } });
    const after: Scope = { ...before, clientIds: grants.map((g) => g.clientId) };

    expect(after.clientIds).toHaveLength(3);
    expect((await listClients(after)).map((c) => c.id)).toContain(clientC);
    await expect(getClient(after, clientC)).resolves.toMatchObject({ name: "Gamma Secret" });

    // And revoking closes it again on the next read.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.userClientScope.deleteMany({ where: { userId, clientId: clientC } });
    });
    await expect(getClient(manager(), clientC)).rejects.toThrow(NotFoundError);
  });

  test("a client under another brand is still governed by scope, not by brand", async () => {
    const stray = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return tx.client.create({ data: { tenantId, brandId: otherBrandId, name: "LineUp One", status: "Active" } });
    });

    // The Manager has no grant for it, so the brand it sits under changes
    // nothing.
    await expect(getClient(manager(), stray.id)).rejects.toThrow(NotFoundError);
    await expect(getClient(admin(), stray.id)).resolves.toBeTruthy();
  });
});
