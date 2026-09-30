/**
 * Seeds a tenant with everything it needs to be usable: the permission
 * catalogue, the five default roles, brands, relationship contexts with their
 * pipelines, and a starting category tree.
 *
 * Safe to re-run. It never deletes: existing rows are left alone, missing ones
 * are created. Users already present keep their password and their role.
 *
 * If backup/pre-platform-*.json exists, the accounts in it are restored with
 * their original password hashes, so nobody has to be handed a new password.
 */
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PERMISSIONS, DEFAULT_ROLES, permissionLabel } from "../src/lib/permissions";

const db = new PrismaClient();

const TENANT = { name: "Hephaestus", slug: "hephaestus" };
const BRANDS = ["Cubane", "ARC3", "LineUp", "Hypergravity"];

const CONTEXTS: Record<string, { name: string; terminal?: boolean }[]> = {
  Investor: [{ name: "Contacted" }, { name: "Interested" }, { name: "Diligence" }, { name: "Committed", terminal: true }, { name: "Passed", terminal: true }],
  KOL: [{ name: "Contacted" }, { name: "Negotiating" }, { name: "Active" }, { name: "Ended", terminal: true }],
  AMA: [{ name: "Requested" }, { name: "Scheduled" }, { name: "Done", terminal: true }],
  Sales: [{ name: "Lead" }, { name: "Qualified" }, { name: "Proposal" }, { name: "Won", terminal: true }, { name: "Lost", terminal: true }],
  Partnership: [{ name: "Intro" }, { name: "Discussing" }, { name: "Agreed" }, { name: "Live" }, { name: "Ended", terminal: true }],
  Media: [{ name: "Pitched" }, { name: "Scheduled" }, { name: "Published", terminal: true }],
};

const SPEND_CATEGORIES = [
  "Salary", "Software", "Cloud & Hosting", "Marketing", "Advertising", "Travel",
  "Food", "Office", "Rent", "Utilities", "Legal", "Consulting", "Equipment", "Taxes", "Other",
];
const INCOME_CATEGORIES = ["Client Payment", "Retainer", "Consulting", "Other Income"];

/** The most recent pre-platform backup, if one was taken. */
function loadBackup(): { users: { email: string; name: string; passwordHash: string; createdAt: string; phone?: string | null; designation?: string | null }[] } | null {
  try {
    const dir = join(process.cwd(), "backup");
    const file = readdirSync(dir).filter((f) => f.startsWith("pre-platform-") && f.endsWith(".json")).sort().pop();
    if (!file) return null;
    return JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  // 1. The permission catalogue — global, outside tenancy.
  for (const key of ALL_PERMISSIONS) {
    const [resource, action] = key.split(":") as [string, string];
    await db.permission.upsert({
      where: { key },
      update: { label: permissionLabel(key) },
      create: { key, resource, action, label: permissionLabel(key) },
    });
  }
  const permissions = await db.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));
  console.log(`permissions: ${permissions.length}`);

  // 2. The tenant — also outside tenancy, it is the root.
  const tenant = await db.tenant.upsert({
    where: { slug: TENANT.slug },
    update: {},
    create: { ...TENANT, settings: { approvalMode: "off", approvalThreshold: 0 } },
  });
  console.log(`tenant: ${tenant.name} (${tenant.id})`);

  // 3. Everything else is tenant-owned, so row-level security applies and the
  //    transaction must say which tenant it is acting as.
  // A generous timeout: this is many small statements against a remote
  // database, and the default five seconds is not enough over the wire.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, TRUE)`;

    // Roles and their permission sets.
    const roleId = new Map<string, string>();
    for (const def of DEFAULT_ROLES) {
      const role = await tx.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: def.name } },
        update: { description: def.description },
        create: { tenantId: tenant.id, name: def.name, description: def.description, isSystem: true },
      });
      roleId.set(def.name, role.id);

      const keys = def.permissions === "all" ? ALL_PERMISSIONS : def.permissions;
      await tx.rolePermission.createMany({
        data: keys.map((key) => ({ tenantId: tenant.id, roleId: role.id, permissionId: permissionId.get(key)! })),
        skipDuplicates: true,
      });
    }
    console.log(`roles: ${[...roleId.keys()].join(", ")}`);

    // Brands.
    for (const name of BRANDS) {
      await tx.brand.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name } },
        update: {},
        create: { tenantId: tenant.id, name },
      });
    }
    console.log(`brands: ${BRANDS.join(", ")}`);

    // Relationship contexts and their pipelines.
    for (const [position, [name, stages]] of Object.entries(CONTEXTS).entries()) {
      const context = await tx.context.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name } },
        update: {},
        create: { tenantId: tenant.id, name, position },
      });
      for (const [i, stage] of stages.entries()) {
        await tx.pipelineStage.upsert({
          where: { contextId_name: { contextId: context.id, name: stage.name } },
          update: {},
          create: { tenantId: tenant.id, contextId: context.id, name: stage.name, position: i, isTerminal: !!stage.terminal },
        });
      }
    }
    console.log(`contexts: ${Object.keys(CONTEXTS).join(", ")}`);

    // Category tree.
    for (const name of SPEND_CATEGORIES) {
      await tx.category.upsert({
        where: { tenantId_name_direction: { tenantId: tenant.id, name, direction: "OUT" } },
        update: {},
        create: { tenantId: tenant.id, name, direction: "OUT" },
      });
    }
    for (const name of INCOME_CATEGORIES) {
      await tx.category.upsert({
        where: { tenantId_name_direction: { tenantId: tenant.id, name, direction: "IN" } },
        update: {},
        create: { tenantId: tenant.id, name, direction: "IN", color: "green" },
      });
    }
    console.log(`categories: ${SPEND_CATEGORIES.length} spend, ${INCOME_CATEGORIES.length} income`);

    // Restore the accounts that existed before the platform schema. The first
    // account created becomes Owner; the rest become Admin, which is the same
    // reach they had under the old two-role model.
    const backup = loadBackup();
    if (!backup?.users?.length) {
      console.log("no backup found — create the first Owner with: npm run db:owner");
      return;
    }

    const byAge = [...backup.users].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    for (const [i, u] of byAge.entries()) {
      const role = i === 0 ? "Owner" : "Admin";
      await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
        update: {},
        create: {
          tenantId: tenant.id,
          email: u.email,
          name: u.name,
          passwordHash: u.passwordHash,
          roleId: roleId.get(role)!,
          allClients: true,
          phone: u.phone ?? null,
          designation: u.designation ?? null,
        },
      });
      console.log(`  ${u.email} → ${role} (existing password kept)`);
    }
  }, { timeout: 120_000, maxWait: 20_000 });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
