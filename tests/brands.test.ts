/**
 * Stage 1 — brands and their field definitions.
 *
 * A brand's field definitions are a schema that non-engineers edit from a form,
 * which makes two edits dangerous in a way the form cannot show: renaming a key
 * orphans every stored value, and changing a type makes every stored value the
 * wrong shape. Neither errors. The values simply stop being found, or start
 * failing validation on a save nobody connected to a change made weeks earlier.
 *
 * Both are refused on the server. These tests are what keeps that true.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { brandSubTags } from "../src/lib/clients";
import { fieldDefsSchema, readCustomFields, readFieldDefs, validateCustomFields } from "../src/lib/custom-fields";
import type { Scope } from "../src/lib/scope";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let brandId: string;
let otherBrandId: string;
let userId: string;
let scopedClientId: string;

function everyone(): Scope {
  return {
    userId,
    tenantId,
    roleName: "Admin",
    permissions: new Set(["client:view", "settings:view", "settings:edit"]),
    allClients: true,
    clientIds: [],
    allContexts: true,
    contextIds: [],
  };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Brands ${suffix}`, slug: `brands-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      const brand = await tx.brand.create({
        data: {
          tenantId,
          name: "ARC3",
          fieldDefs: [{ key: "tier", label: "Tier", type: "select", required: false, options: ["Gold", "Silver"] }],
        },
      });
      brandId = brand.id;

      const other = await tx.brand.create({ data: { tenantId, name: "LineUp" } });
      otherBrandId = other.id;

      const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
      const user = await tx.user.create({
        data: { tenantId, email: `admin-${suffix}@test.dev`, name: "Admin", passwordHash: "x", roleId: role.id, allClients: true },
      });
      userId = user.id;

      const scoped = await tx.client.create({
        data: { tenantId, brandId: brand.id, name: "Alpha", subTag: "Internal", status: "Active", customFields: { tier: "Gold" } },
      });
      scopedClientId = scoped.id;

      await tx.client.createMany({
        data: [
          { tenantId, brandId: brand.id, name: "Beta", subTag: "Jay", status: "Active" },
          { tenantId, brandId: brand.id, name: "Gamma", subTag: "Internal", status: "Active" },
          { tenantId, brandId: other.id, name: "Delta", subTag: "Roster", status: "Active" },
        ],
      });
    },
    { timeout: 60_000 },
  );
}, 90_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `brands-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("field definitions as a schema people edit", () => {
  test("a valid set round-trips through storage unchanged", async () => {
    const defs = [
      { key: "contract_end", label: "Contract ends", type: "date", required: true },
      { key: "channels", label: "Channels", type: "multiselect", required: false, options: ["X", "YouTube"] },
    ];

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.brand.update({ where: { id: otherBrandId }, data: { fieldDefs: defs } });
    });

    const stored = await tenantDb(tenantId).brand.findUniqueOrThrow({ where: { id: otherBrandId } });
    expect(readFieldDefs(stored.fieldDefs)).toEqual([
      { key: "contract_end", label: "Contract ends", type: "date", required: true },
      { key: "channels", label: "Channels", type: "multiselect", required: false, options: ["X", "YouTube"] },
    ]);
  });

  test("a key that is not a safe identifier is refused for the whole set", () => {
    // The key becomes a JSONB property name and a form input id, so spaces and
    // capitals are refused rather than silently normalised into a second key.
    for (const key of ["Contract End", "contract-end", "2tier", "", "a".repeat(41)]) {
      expect(fieldDefsSchema.safeParse([{ key, label: "X", type: "text" }]).success).toBe(false);
    }
    expect(fieldDefsSchema.safeParse([{ key: "contract_end2", label: "X", type: "text" }]).success).toBe(true);
  });

  test("a choice field with no choices is refused", () => {
    expect(fieldDefsSchema.safeParse([{ key: "tier", label: "Tier", type: "select" }]).success).toBe(false);
    expect(fieldDefsSchema.safeParse([{ key: "tier", label: "Tier", type: "select", options: [] }]).success).toBe(false);
    expect(
      fieldDefsSchema.safeParse([{ key: "tier", label: "Tier", type: "select", options: ["Gold"] }]).success,
    ).toBe(true);
  });

  test("two fields cannot share a key, and the error points at the second one", () => {
    const result = fieldDefsSchema.safeParse([
      { key: "tier", label: "Tier", type: "text" },
      { key: "tier", label: "Level", type: "text" },
    ]);

    expect(result.success).toBe(false);
    // The index is in the path, which is how the editor highlights the row.
    expect(result.error?.issues[0]?.path).toEqual([1, "key"]);
  });
});

describe("what a definition change does to stored values", () => {
  test("renaming the key orphans every value — which is why the server refuses it", async () => {
    const client = await tenantDb(tenantId).client.findUniqueOrThrow({ where: { id: scopedClientId } });
    expect((client.customFields as Record<string, unknown>).tier).toBe("Gold");

    // The rename that must never be allowed: same field, new key.
    const renamed = readFieldDefs([{ key: "tier_level", label: "Tier", type: "select", options: ["Gold", "Silver"] }]);

    // The value is still in the column, and is now unreachable — no error
    // anywhere, which is exactly what makes it dangerous.
    expect(readCustomFields(renamed, client.customFields)).toEqual({ tier_level: null });
    expect((client.customFields as Record<string, unknown>).tier).toBe("Gold");
  });

  test("changing the type leaves stored values the wrong shape — likewise refused", () => {
    const asMultiselect = readFieldDefs([
      { key: "tier", label: "Tier", type: "multiselect", options: ["Gold", "Silver"] },
    ]);

    // "Gold" was valid as a select. As a multiselect the same client now fails
    // on its next save, for a change made to the brand weeks earlier.
    const { errors } = validateCustomFields(asMultiselect, { tier: "Gold" });
    expect(errors).toEqual({});

    // …and a number that was stored as a number is not a valid choice at all.
    const { errors: bad } = validateCustomFields(asMultiselect, { tier: 42 });
    expect(bad["customFields.tier"]).toBeDefined();
  });

  test("removing a field hides it, and the value survives until the next save", async () => {
    const client = await tenantDb(tenantId).client.findUniqueOrThrow({ where: { id: scopedClientId } });

    // Read through no definitions: nothing shows.
    expect(readCustomFields([], client.customFields)).toEqual({});
    // But the column still holds it, so removing a field by mistake is
    // recoverable by putting the definition back.
    expect((client.customFields as Record<string, unknown>).tier).toBe("Gold");

    // The next save is what drops it, because validateCustomFields only ever
    // writes keys the brand currently defines.
    const { values } = validateCustomFields([], { tier: "Gold" });
    expect(values).toEqual({});
  });

  test("making a field required does not retroactively invalidate what is stored", async () => {
    const required = readFieldDefs([{ key: "tier", label: "Tier", type: "select", required: true, options: ["Gold", "Silver"] }]);
    const withoutValue = await tenantDb(tenantId).client.findFirstOrThrow({ where: { name: "Beta" } });

    // Nothing rewrites Beta on the spot. It is only when somebody next saves
    // Beta that the requirement is enforced — which is the moment they can act
    // on it.
    expect(readCustomFields(required, withoutValue.customFields)).toEqual({ tier: null });
    expect(validateCustomFields(required, {}).errors["customFields.tier"]).toEqual(["Tier is required"]);
  });
});

describe("sub-tag suggestions", () => {
  test("each brand suggests only what it already uses, without duplicates", async () => {
    const byBrand = await brandSubTags(everyone());

    expect(byBrand[brandId]?.sort()).toEqual(["Internal", "Jay"]); // Internal appears twice, listed once
    expect(byBrand[otherBrandId]).toEqual(["Roster"]);
    // A brand's suggestions never include another brand's.
    expect(byBrand[brandId]).not.toContain("Roster");
  });

  test("suggestions respect scope, so they cannot leak a tag from a hidden client", async () => {
    const restricted: Scope = { ...everyone(), allClients: false, clientIds: [scopedClientId] };

    const byBrand = await brandSubTags(restricted);
    expect(byBrand[brandId]).toEqual(["Internal"]); // Beta's "Jay" is not visible
    expect(byBrand[otherBrandId]).toBeUndefined();
  });

  test("a client with no sub-tag contributes nothing rather than an empty entry", async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.create({ data: { tenantId, brandId: otherBrandId, name: "Epsilon", status: "Active" } });
    });

    const byBrand = await brandSubTags(everyone());
    expect(byBrand[otherBrandId]).toEqual(["Roster"]);
    expect(byBrand[otherBrandId]).not.toContain("");
  });

  test("archived and deleted clients do not keep a tag alive after it stops being used", async () => {
    const gamma = await tenantDb(tenantId).client.findFirstOrThrow({ where: { name: "Gamma" } });
    const alpha = await tenantDb(tenantId).client.findFirstOrThrow({ where: { name: "Alpha" } });

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.update({ where: { id: gamma.id }, data: { deletedAt: new Date() } });
      await tx.client.update({ where: { id: alpha.id }, data: { deletedAt: new Date() } });
    });

    // Both "Internal" clients are gone, so the suggestion goes with them
    // rather than lingering as a tag nothing uses.
    const byBrand = await brandSubTags(everyone());
    expect(byBrand[brandId]).toEqual(["Jay"]);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.client.updateMany({ where: { id: { in: [gamma.id, alpha.id] } }, data: { deletedAt: null } });
    });
  });
});
