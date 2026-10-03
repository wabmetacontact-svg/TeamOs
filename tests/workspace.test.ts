/**
 * Isolation and scoping against a real database.
 *
 * Two promises are checked here rather than trusted:
 *   1. One workspace can never read another's rows, even through a query that
 *      forgets to filter — row-level security answers, not the code.
 *   2. The workspace a person is sent contains only what their access allows:
 *      clients they have a grant on, money only with Finance, salaries only
 *      with Payroll, and the audit entries about those things.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PRESETS } from "../src/lib/access";
import { tenantDb } from "../src/lib/db";
import { loadWorkspace } from "../src/lib/workspace";
import type { Signed } from "../src/lib/auth";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = Date.now().toString(36);

const ids = {} as Record<string, string>;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function seed(slug: string, name: string) {
  const t = await owner.tenant.create({ data: { name, slug } });
  const dept = await owner.taskDepartment.create({ data: { tenantId: t.id, name: "Tech", color: "#2563EB" } });
  const brand = await owner.brand.create({ data: { tenantId: t.id, name: `${name} brand` } });
  return { t, dept, brand };
}

beforeAll(async () => {
  const a = await seed(`ws-a-${suffix}`, "Alpha");
  const b = await seed(`ws-b-${suffix}`, "Beta");
  ids.a = a.t.id;
  ids.b = b.t.id;

  const T = a.t.id;
  const boss = await owner.member.create({ data: { tenantId: T, name: "Boss", email: `boss-${suffix}@a.test`, passwordHash: "x", isOwner: true } });
  const worker = await owner.member.create({
    data: { tenantId: T, name: "Worker", email: `worker-${suffix}@a.test`, passwordHash: "x", features: PRESETS.Member!, salary: 5_000_000n },
  });
  const books = await owner.member.create({
    data: { tenantId: T, name: "Books", email: `books-${suffix}@a.test`, passwordHash: "x", features: PRESETS.Finance! },
  });
  ids.boss = boss.id;
  ids.worker = worker.id;
  ids.books = books.id;

  const seen = await owner.client.create({ data: { tenantId: T, brandId: a.brand.id, name: "Seen Co", retainer: 10_000_000n } });
  const hidden = await owner.client.create({ data: { tenantId: T, brandId: a.brand.id, name: "Hidden Co", retainer: 20_000_000n } });
  ids.seen = seen.id;
  ids.hidden = hidden.id;

  await owner.clientGrant.createMany({
    data: [
      { tenantId: T, memberId: worker.id, clientId: seen.id, level: "edit" },
      { tenantId: T, memberId: books.id, clientId: seen.id, level: "finance" },
      { tenantId: T, memberId: books.id, clientId: hidden.id, level: "finance" },
    ],
  });

  const task = (title: string, clientId: string | null) => ({
    tenantId: T,
    title,
    brandId: a.brand.id,
    clientId,
    assigneeId: boss.id,
    assignedById: boss.id,
    departmentId: a.dept.id,
    createdOn: day("2026-09-01"),
  });
  await owner.task.createMany({ data: [task("Seen task", seen.id), task("Hidden task", hidden.id), task("Brand task", null)] });

  const entry = (description: string, clientId: string | null, category: string) => ({
    tenantId: T,
    type: "out",
    date: day("2026-09-10"),
    description,
    clientId,
    category,
    amount: 100_000n,
    createdById: boss.id,
  });
  await owner.ledgerEntry.createMany({
    data: [entry("Seen spend", seen.id, "Software"), entry("Hidden spend", hidden.id, "Software"), entry("Office rent", null, "Rent"), entry("Salary", null, "Salaries")],
  });

  await owner.auditEntry.createMany({
    data: [
      { tenantId: T, actorName: "Boss", kind: "client", text: "about seen", target: "Seen Co", clientId: seen.id },
      { tenantId: T, actorName: "Boss", kind: "client", text: "about hidden", target: "Hidden Co", clientId: hidden.id },
      { tenantId: T, actorName: "Boss", kind: "team", text: "payroll thing", target: "Payroll", area: "payroll" },
      { tenantId: T, actorName: "Boss", kind: "access", text: "access thing", target: "Access", area: "access" },
    ],
  });

  // Something in the other workspace for the isolation checks to not see.
  await owner.member.create({ data: { tenantId: b.t.id, name: "Other", email: `other-${suffix}@b.test`, passwordHash: "x", isOwner: true } });
  await owner.client.create({ data: { tenantId: b.t.id, brandId: b.brand.id, name: "Beta's client" } });
}, 120_000);

afterAll(async () => {
  await owner.tenant.deleteMany({ where: { slug: { in: [`ws-a-${suffix}`, `ws-b-${suffix}`] } } });
  await owner.$disconnect();
  await app.$disconnect();
});

async function signedAs(memberId: string): Promise<Signed> {
  const me = await owner.member.findUniqueOrThrow({ where: { id: memberId } });
  const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: me.tenantId } });
  return { sessionId: "test", tenant, me, viewer: me, previewing: false };
}

describe("row-level security", () => {
  test("with no tenant set, the application role sees nothing at all", async () => {
    expect(await app.client.count()).toBe(0);
    expect(await app.member.count()).toBe(0);
    expect(await app.tenant.count()).toBe(0);
  });

  test("bound to one workspace, a query with no filter sees only that workspace", async () => {
    const names = (await tenantDb(ids.b!).client.findMany()).map((c) => c.name);
    expect(names).toEqual(["Beta's client"]);
    const tenants = await tenantDb(ids.b!).tenant.findMany();
    expect(tenants.map((t) => t.id)).toEqual([ids.b]);
  });

  test("a write into another workspace is refused by the database", async () => {
    await expect(
      tenantDb(ids.b!).brand.create({ data: { tenantId: ids.a!, name: `smuggled-${suffix}` } }),
    ).rejects.toThrow();
  });

  test("the audit log cannot be edited by the application", async () => {
    await expect(tenantDb(ids.a!).auditEntry.updateMany({ data: { text: "rewritten" } })).rejects.toThrow();
  });

  test("login lookup finds the workspace for an address and nothing more", async () => {
    const rows = await app.$queryRaw<{ tenant_id: string }[]>`SELECT * FROM auth_tenants_for_email(${`boss-${suffix}@a.test`})`;
    expect(rows.map((r) => r.tenant_id)).toEqual([ids.a]);
  });
});

describe("what each person is sent", () => {
  test("an owner gets everything", async () => {
    const w = await loadWorkspace(await signedAs(ids.boss!));
    expect(w.clients.map((c) => c.name).sort()).toEqual(["Hidden Co", "Seen Co"]);
    expect(w.ledger).toHaveLength(4);
    expect(w.audit).toHaveLength(4);
    expect(w.members.find((m) => m.id === ids.worker)?.salary).toBe(50_000);
  });

  test("a member sees only their client, without its money", async () => {
    const w = await loadWorkspace(await signedAs(ids.worker!));
    expect(w.clients.map((c) => c.name)).toEqual(["Seen Co"]);
    expect(w.clients[0]!.retainer).toBeNull();
    expect(w.tasks.map((t) => t.title).sort()).toEqual(["Brand task", "Seen task"]);
    expect(w.ledger).toEqual([]);
    expect(JSON.stringify(w)).not.toContain("Hidden Co");
  });

  test("a member never receives salaries", async () => {
    const w = await loadWorkspace(await signedAs(ids.worker!));
    const worker = w.members.find((m) => m.id === ids.worker)!;
    expect(worker.salary).toBeNull();
    expect(worker.onPayroll).toBe(true);
    expect(worker.salaryHistory).toEqual([]);
  });

  test("finance sees money on its clients and overhead, including salaries with Payroll", async () => {
    const w = await loadWorkspace(await signedAs(ids.books!));
    expect(w.ledger.map((e) => e.desc).sort()).toEqual(["Hidden spend", "Office rent", "Salary", "Seen spend"]);
    expect(w.clients.find((c) => c.name === "Seen Co")?.retainer).toBe(100_000);
  });

  test("audit entries follow the same reach", async () => {
    const worker = await loadWorkspace(await signedAs(ids.worker!));
    expect(worker.audit.map((a) => a.text)).toEqual(["about seen"]);
    const books = await loadWorkspace(await signedAs(ids.books!));
    expect(books.audit.map((a) => a.text).sort()).toEqual(["about hidden", "about seen", "payroll thing"]);
  });
});
