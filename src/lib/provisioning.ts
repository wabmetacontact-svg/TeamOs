import "server-only";
import { db } from "./db";
import { ALL_PERMISSIONS, DEFAULT_ROLES, permissionLabel, type PermissionKey } from "./permissions";

/**
 * Bringing a new workspace into existence.
 *
 * A tenant row on its own is useless: no roles, so nobody can be granted
 * anything; no pipelines, so the relationship module has nowhere to put a
 * person; no categories, so every ledger entry is uncategorised. The first
 * person through the door would find a working application that refuses to do
 * anything, and would leave.
 *
 * So provisioning creates the whole shape in one transaction. If any part of it
 * fails, no half-built workspace is left behind for somebody to find later and
 * wonder about.
 *
 * What it deliberately does NOT create: brands and clients. Those are the
 * workspace's actual business, and guessing at them produces four rows called
 * "Brand 1" that everybody has to delete before they can start.
 */

/** Pipelines almost every agency turns out to want, with usable stages. */
const DEFAULT_CONTEXTS: { name: string; stages: { name: string; isTerminal?: boolean }[] }[] = [
  {
    name: "Sales",
    stages: [
      { name: "Lead" },
      { name: "In conversation" },
      { name: "Proposal sent" },
      { name: "Won", isTerminal: true },
      { name: "Lost", isTerminal: true },
    ],
  },
  {
    name: "Partnership",
    stages: [
      { name: "Introduced" },
      { name: "Exploring" },
      { name: "Agreed", isTerminal: true },
      { name: "Passed", isTerminal: true },
    ],
  },
];

/** A starting chart of accounts. Two levels, because that is the limit. */
const DEFAULT_CATEGORIES: { name: string; direction: "IN" | "OUT"; children?: string[] }[] = [
  { name: "People", direction: "OUT", children: ["Salaries", "Contractors", "Freelancers"] },
  { name: "Software", direction: "OUT", children: ["Subscriptions", "Hosting", "Tools"] },
  { name: "Office", direction: "OUT", children: ["Rent", "Utilities", "Supplies"] },
  { name: "Marketing", direction: "OUT", children: ["Ads", "Content", "Events"] },
  { name: "Professional", direction: "OUT", children: ["Legal", "Accounting"] },
  { name: "Travel", direction: "OUT" },
  { name: "Other", direction: "OUT" },
  { name: "Client revenue", direction: "IN", children: ["Retainer", "Project", "Commission"] },
  { name: "Other income", direction: "IN" },
];

export type ProvisionInput = {
  workspaceName: string;
  ownerEmail: string;
  ownerName: string;
  /** Already hashed. This function never sees a plaintext password. */
  passwordHash: string;
  baseCurrency?: string;
  timezone?: string;
};

export type ProvisionResult = { tenantId: string; userId: string; slug: string };

/**
 * A URL-safe, human-readable slug, unique across tenants.
 *
 * Collisions are resolved by appending a number rather than random characters,
 * because the slug is something people read and say out loud.
 */
export async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";

  const taken = await db.tenant.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const used = new Set(taken.map((t) => t.slug));

  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Creates the tenant and everything it needs to be usable, plus its first user
 * as Owner.
 *
 * Runs on the raw client because there is no tenant to bind to until this
 * transaction has created one — so it sets `app.tenant_id` itself, on the new
 * id, the moment that id exists. Everything after that line is under the
 * ordinary policy.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const slug = await uniqueSlug(input.workspaceName);

  // The permission catalogue is global and seeded once. A workspace created
  // before a new permission was added would otherwise silently lack it.
  await ensurePermissions();

  const permissions = await db.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  return db.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.workspaceName.trim(),
          slug,
          baseCurrency: input.baseCurrency ?? "INR",
          timezone: input.timezone ?? "Asia/Kolkata",
        },
      });

      const tenantId = tenant.id;
      // From here on every write is under the tenant policy, exactly as the
      // rest of the application is.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      // ── roles, with their permissions
      let ownerRoleId = "";
      for (const def of DEFAULT_ROLES) {
        const role = await tx.role.create({
          data: { tenantId, name: def.name, description: def.description, isSystem: true },
        });
        if (def.name === "Owner") ownerRoleId = role.id;

        const keys: PermissionKey[] = def.permissions === "all" ? ALL_PERMISSIONS : def.permissions;
        await tx.rolePermission.createMany({
          data: keys
            .map((key) => idByKey.get(key))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ tenantId, roleId: role.id, permissionId })),
        });
      }

      if (!ownerRoleId) throw new Error("DEFAULT_ROLES no longer contains an Owner");

      // ── pipelines
      for (const [position, context] of DEFAULT_CONTEXTS.entries()) {
        const created = await tx.context.create({ data: { tenantId, name: context.name, position } });
        await tx.pipelineStage.createMany({
          data: context.stages.map((stage, i) => ({
            tenantId,
            contextId: created.id,
            name: stage.name,
            position: i,
            isTerminal: stage.isTerminal ?? false,
          })),
        });
      }

      // ── categories, parents before children
      for (const category of DEFAULT_CATEGORIES) {
        const parent = await tx.category.create({
          data: { tenantId, name: category.name, direction: category.direction },
        });
        if (category.children?.length) {
          await tx.category.createMany({
            data: category.children.map((name) => ({
              tenantId,
              name,
              direction: category.direction,
              parentId: parent.id,
            })),
          });
        }
      }

      // ── the first user, who owns the place
      const user = await tx.user.create({
        data: {
          tenantId,
          email: input.ownerEmail.trim().toLowerCase(),
          name: input.ownerName.trim(),
          passwordHash: input.passwordHash,
          roleId: ownerRoleId,
          allClients: true,
          allContexts: true,
          // They arrived by clicking a link sent to this address, which is the
          // proof; asking again would be asking twice.
          emailVerifiedAt: new Date(),
        },
      });

      await tx.auditEntry.create({
        data: {
          tenantId,
          actorId: user.id,
          action: "workspace_created",
          resourceType: "Tenant",
          resourceId: tenantId,
          resourceLabel: tenant.name,
          after: { slug, owner: user.email },
        },
      });

      return { tenantId, userId: user.id, slug };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/**
 * Makes sure every key in the catalogue exists as a row.
 *
 * The catalogue is code and the rows are data, so they drift the moment a
 * permission is added. Running this on every provision means a workspace
 * created today has the keys added last week, and one created last year gets
 * them the next time anybody signs up.
 */
export async function ensurePermissions(): Promise<number> {
  const existing = await db.permission.findMany({ select: { key: true } });
  const have = new Set(existing.map((p) => p.key));
  const missing = ALL_PERMISSIONS.filter((key) => !have.has(key));

  if (missing.length === 0) return 0;

  await db.permission.createMany({
    data: missing.map((key) => {
      const [resource, action] = key.split(":");
      return { key, resource: resource!, action: action!, label: permissionLabel(key) };
    }),
    skipDuplicates: true,
  });

  return missing.length;
}
