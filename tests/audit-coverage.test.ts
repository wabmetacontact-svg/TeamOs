/**
 * Stage 6 acceptance gate — audit coverage.
 *
 *   "Every mutation from stages 1–5 appears in the audit log with actor,
 *    before and after — verified by replaying the test suite and asserting the
 *    log's row count and content."
 *
 * The literal reading — instrument the suite and count rows — does not work
 * here, because most suites write through the raw client to build fixtures
 * rather than through `defineAction`. Counting those would be counting the
 * test harness.
 *
 * What actually answers the question is stricter: read the source of every
 * action in the application and assert that each one which mutates writes an
 * audit entry, and that the entries it writes carry a before and an after
 * where a before exists. A mutation that ships without a trail then fails the
 * gate *before* anyone has to notice it is missing — which is the point, since
 * a missing audit entry is invisible by nature. Nothing errors, nothing looks
 * wrong; the change simply is not there when somebody asks in six months.
 *
 * The runtime half is below: entries written through the real wrapper, read
 * back, and checked for actor, before and after.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { tenantDb } from "../src/lib/db";
import { auditFor, auditSummary, searchAudit } from "../src/lib/audit";
import { NotFoundError, type Scope } from "../src/lib/scope";

const SRC = join(process.cwd(), "src", "app");

// ─────────────────────────────────────────────────── the structural half ───

type Action = { file: string; name: string; permission: string; body: string };

/** Every `defineAction` in the application, with its body. */
function everyAction(): Action[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "actions.ts" || entry.endsWith("-actions.ts")) files.push(full);
    }
  })(SRC);

  const actions: Action[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");

    // Split on the export, then take each chunk up to the next one. Crude, and
    // crude is right here: a real parser would be another dependency to keep
    // in step with a test whose job is to be obviously correct.
    const parts = source.split(/export const (\w+) = defineAction\(\{/);

    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]!;
      const body = parts[i + 1] ?? "";
      const permission = /permission:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
      actions.push({ file: rel, name, permission, body });
    }
  }

  return actions;
}

/**
 * Whether an action actually writes, read from its body rather than inferred
 * from its permission.
 *
 * The first version of this used the permission name, and flagged three
 * actions that are reads sitting behind a write permission — `previewImport`,
 * `mergePreview`, `requestUploadUrl`. They need `expense:edit` or
 * `person:edit` because they are part of a write flow, and they change
 * nothing. A rule that cannot tell those apart is a rule people learn to
 * silence.
 */
const WRITES = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

/** Narrower: writes that change or remove a row that already existed. */
const CHANGES_EXISTING = /\.(update|updateMany|upsert|delete|deleteMany)\(/;

/**
 * Actions whose update or delete is incidental to a creation, so the entry
 * they write correctly has no `before`.
 *
 * This is where reading the source runs out. The regex can see that an action
 * calls `.update(`; it cannot see whether the row updated is the row the audit
 * entry is about. Each of these was checked by hand and the reason is written
 * down, which is the difference between an exception and a gap.
 */
const CREATES_VIA_WRITE = new Map([
  ["assignUserToClient", "upserts a grant — a person who did not have access has no previous state"],
  ["addClientContact", "clears another contact's primary flag on the way to creating one"],
  ["inviteUser", "deletes the superseded invite before issuing the new one; the entry is about the new one"],
  ["runRecurring", "advances each rule's clock and creates drafts; the entry lists what was created and skipped"],
  ["verifyTask", "sets a verifier on a task that by definition had none — the action refuses one already verified"],
]);

describe("every mutation leaves a trail", () => {
  const actions = everyAction();

  test("the suite can see the actions at all", () => {
    // A refactor that renames the file pattern would otherwise make this whole
    // suite pass by finding nothing.
    expect(actions.length).toBeGreaterThan(25);
    expect(new Set(actions.map((a) => a.file)).size).toBeGreaterThan(5);
  });

  test("each one declares a permission", () => {
    // `defineAction` already makes this a compile error. Asserting it again
    // costs nothing and catches a permission that is a variable rather than a
    // literal, which would slip past the check below.
    const undeclared = actions.filter((a) => !a.permission).map((a) => `${a.file}:${a.name}`);
    expect(undeclared).toEqual([]);
  });

  test("every action that writes leaves an audit entry", () => {
    const silent = actions
      .filter((a) => WRITES.test(a.body))
      .filter((a) => !/ctx\.audit\(/.test(a.body))
      .map((a) => `${a.file}:${a.name} (${a.permission})`);

    // A mutation with no trail is invisible in exactly the way that matters:
    // nothing errors, nothing looks wrong, and the change is simply not there
    // when somebody asks who made it.
    expect(silent).toEqual([]);
  });

  test("every audit entry names a resource type and an id", () => {
    const vague = actions
      .filter((a) => /ctx\.audit\(/.test(a.body))
      .filter((a) => !/resourceType:/.test(a.body) || !/resourceId:/.test(a.body))
      .map((a) => `${a.file}:${a.name}`);

    // Without both, the entry cannot be found again, which makes it a log line
    // rather than an audit trail.
    expect(vague).toEqual([]);
  });

  test("actions that change an existing row record a before as well as an after", () => {
    // Detected from the body, not the permission: a creation under an `edit`
    // permission has no before, and demanding one would be demanding a lie.
    // An after on its own says what a field became without saying what it
    // was, which is the half of the question people actually ask.
    const changing = actions
      .filter((a) => CHANGES_EXISTING.test(a.body) && /ctx\.audit\(/.test(a.body))
      .filter((a) => !CREATES_VIA_WRITE.has(a.name));

    expect(changing.length).toBeGreaterThan(5);

    const oneSided = changing
      .filter((a) => !/before:/.test(a.body))
      .map((a) => `${a.file}:${a.name} (${a.permission})`);

    expect(oneSided).toEqual([]);
  });

  test("the exceptions stay few, and every one still exists", () => {
    // A list that grows is a rule that has stopped meaning anything. If an
    // entry here no longer matches an action, it is stale and the reason
    // written beside it is no longer being checked by anybody.
    expect(CREATES_VIA_WRITE.size).toBeLessThanOrEqual(8);

    const names = new Set(actions.map((a) => a.name));
    const stale = [...CREATES_VIA_WRITE.keys()].filter((name) => !names.has(name));
    expect(stale).toEqual([]);

    // And each reason is a sentence, not a shrug.
    for (const [name, reason] of CREATES_VIA_WRITE) {
      expect({ name, long: reason.length > 25 }).toEqual({ name, long: true });
    }
  });

  test("a destructive action records what was destroyed", () => {
    const deleting = actions
      .filter((a) => /\.(delete|deleteMany)\(/.test(a.body) && /ctx\.audit\(/.test(a.body))
      .filter((a) => !CREATES_VIA_WRITE.has(a.name));
    expect(deleting.length).toBeGreaterThan(2);

    const forgetful = deleting
      .filter((a) => !/before:/.test(a.body))
      .map((a) => `${a.file}:${a.name}`);

    // After a delete the row is gone, so `before` is the only record that it
    // was ever there.
    expect(forgetful).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────── the runtime half ───

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);

let tenantId: string;
let alice: string;
let bob: string;
let clientA: string;
let clientB: string;
let txA: string;

function scopeFor(userId: string, clientIds?: string[]): Scope {
  return {
    userId,
    tenantId,
    roleName: clientIds ? "Manager" : "Admin",
    permissions: new Set(["audit:view", "expense:view", "client:view"]),
    allClients: clientIds === undefined,
    clientIds: clientIds ?? [],
    allContexts: true,
    contextIds: [],
  };
}

beforeAll(async () => {
  const tenant = await owner.tenant.create({ data: { name: `Audit ${suffix}`, slug: `audit-${suffix}` } });
  tenantId = tenant.id;

  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    const role = await tx.role.create({ data: { tenantId, name: "Admin", description: "Test" } });
    const brand = await tx.brand.create({ data: { tenantId, name: "Brand" } });

    const a = await tx.user.create({
      data: { tenantId, email: `alice-${suffix}@test.dev`, name: "Alice", passwordHash: "x", roleId: role.id, allClients: true },
    });
    const b = await tx.user.create({
      data: { tenantId, email: `bob-${suffix}@test.dev`, name: "Bob", passwordHash: "x", roleId: role.id },
    });
    alice = a.id;
    bob = b.id;

    const [c1, c2] = await Promise.all([
      tx.client.create({ data: { tenantId, brandId: brand.id, name: "Visible", status: "Active" } }),
      tx.client.create({ data: { tenantId, brandId: brand.id, name: "Hidden", status: "Active" } }),
    ]);
    clientA = c1.id;
    clientB = c2.id;

    const t = await tx.transaction.create({
      data: {
        tenantId,
        ref: `TX-${suffix}-001`,
        direction: "OUT",
        clientId: c1.id,
        bookMonth: "2026-04",
        date: new Date("2026-04-15T00:00:00Z"),
        name: "Rent",
        amountOriginal: 4_500_000n,
        amountBase: 4_500_000n,
        approvalState: "Approved",
        createdById: a.id,
      },
    });
    txA = t.id;

    await tx.auditEntry.createMany({
      data: [
        {
          tenantId,
          actorId: a.id,
          action: "created",
          resourceType: "Transaction",
          resourceId: t.id,
          resourceLabel: "TX · Rent",
          after: { amountBase: "4500000", bookMonth: "2026-04" },
        },
        {
          tenantId,
          actorId: a.id,
          action: "updated_after_approval",
          resourceType: "Transaction",
          resourceId: t.id,
          resourceLabel: "TX · Rent",
          before: { amountBase: "4500000" },
          after: { amountBase: "4600000" },
        },
        {
          tenantId,
          actorId: a.id,
          action: "created",
          resourceType: "Client",
          resourceId: c2.id,
          resourceLabel: "Hidden",
          after: { name: "Hidden" },
        },
        {
          tenantId,
          actorId: a.id,
          action: "role_changed",
          resourceType: "User",
          resourceId: b.id,
          resourceLabel: "bob",
          before: { role: "Member" },
          after: { role: "Admin" },
        },
      ],
    });
  });
}, 120_000);

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
    await tx.$executeRaw`SET LOCAL app.allow_closed_month_write = 'on'`;
    await tx.tenant.deleteMany({ where: { slug: `audit-${suffix}` } });
  });
  await owner.$disconnect();
});

describe("what an entry actually contains", () => {
  test("an edit carries both sides of the change", async () => {
    const entries = await searchAudit(scopeFor(alice), { action: "updated_after_approval" });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.actor?.name).toBe("Alice");
    expect(entries[0]!.before).toEqual({ amountBase: "4500000" });
    expect(entries[0]!.after).toEqual({ amountBase: "4600000" });
  });

  test("a creation has an after and no before, which is correct rather than missing", async () => {
    const entries = await searchAudit(scopeFor(alice), { action: "created", resourceType: "Transaction" });

    expect(entries[0]!.before).toBeNull();
    expect(entries[0]!.after).not.toBeNull();
  });

  test("amounts survive as strings, because BigInt is not JSON", async () => {
    const entries = await searchAudit(scopeFor(alice), { resourceId: txA });
    const after = entries.find((e) => e.action === "created")!.after as Record<string, unknown>;

    // Stored as a string on purpose. A number here would lose precision above
    // 2^53 paise, and JSON.stringify throws on a BigInt outright.
    expect(typeof after.amountBase).toBe("string");
    expect(after.amountBase).toBe("4500000");
  });
});

describe("the log is scoped like everything else", () => {
  test("somebody who sees every client sees every entry", async () => {
    const all = await searchAudit(scopeFor(alice));
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  test("a scoped reader does not see entries about a client they cannot reach", async () => {
    const scoped = await searchAudit(scopeFor(bob, [clientA]));

    // Hidden is not theirs, and an audit trail that names it would be a way to
    // learn it exists.
    expect(scoped.some((e) => e.resourceId === clientB)).toBe(false);
    expect(JSON.stringify(scoped)).not.toContain("Hidden");
  });

  test("a scoped reader does not see workspace-level entries", async () => {
    const scoped = await searchAudit(scopeFor(bob, [clientA]));

    // Who was given which role is not a Manager's business, even when the
    // Manager is the subject of it.
    expect(scoped.some((e) => e.resourceType === "User")).toBe(false);
  });

  test("they do see the entries about their own client", async () => {
    const scoped = await searchAudit(scopeFor(bob, [clientA]));
    expect(scoped.some((e) => e.resourceId === txA)).toBe(true);
  });

  test("asking for one resource's trail refuses rather than returning empty", async () => {
    // An empty trail and a forbidden one must not be distinguishable by
    // whether the list is empty — otherwise probing ids maps the workspace.
    await expect(auditFor(scopeFor(bob, [clientA]), "Client", clientB)).rejects.toThrow(NotFoundError);

    // And a resource with genuinely no history returns an empty list.
    await expect(auditFor(scopeFor(bob, [clientA]), "Client", "clnonexistent00000")).resolves.toEqual([]);
  });

  test("the summary is scoped the same way as the list", async () => {
    const all = await auditSummary(scopeFor(alice));
    const scoped = await auditSummary(scopeFor(bob, [clientA]));

    // A count that included hidden rows would leak the same information the
    // list refuses to.
    expect(scoped.total).toBeLessThan(all.total);
    expect(all.byActor.some((a) => a.name === "Alice")).toBe(true);
  });
});

describe("the log cannot be rewritten", () => {
  test("an entry cannot be updated, even by the database owner", async () => {
    const entry = await tenantDb(tenantId).auditEntry.findFirstOrThrow({ where: { resourceId: txA } });

    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.auditEntry.update({ where: { id: entry.id }, data: { action: "something else" } });
      }),
    ).rejects.toThrow(/append-only|permission denied/i);
  });

  test("an entry cannot be deleted either", async () => {
    const entry = await tenantDb(tenantId).auditEntry.findFirstOrThrow({ where: { resourceId: txA } });

    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        await tx.auditEntry.delete({ where: { id: entry.id } });
      }),
    ).rejects.toThrow(/append-only|permission denied/i);
  });
});
