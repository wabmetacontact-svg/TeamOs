/**
 * Receiving WabMeta's push.
 *
 * The signature and the contract are checked on their own, with no database.
 * Everything after that runs against the real one through the application's
 * restricted role, so the row-level security policies are in force exactly as
 * they are in production.
 *
 * The test that matters most is the dull one: applying the same event twice
 * leaves one row. Push cannot promise single delivery, so that property is the
 * only thing standing between a retried payment and money counted twice.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
}));

class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const {
  MAX_SKEW_SECONDS,
  SOURCE,
  WABMETA_BRAND,
  applyEvent,
  applyEvents,
  sign,
  syncBody,
  verify,
} = await import("../src/lib/wabmeta");
const { signup } = await import("../src/app/(auth)/actions");
const { getSigned } = await import("../src/lib/auth");

// ───────────────────────────────────────────────────────────── no database ───

describe("the signature", () => {
  const secret = "shared-secret";
  const body = '{"events":[]}';
  const ts = String(Math.floor(Date.now() / 1000));

  test("a request signed with the secret is accepted", () => {
    expect(verify({ rawBody: body, signature: sign(body, ts, secret), timestamp: ts, secret })).toEqual({ ok: true });
  });

  test("a different secret is refused", () => {
    const r = verify({ rawBody: body, signature: sign(body, ts, "other"), timestamp: ts, secret });
    expect(r).toMatchObject({ ok: false });
  });

  test("a changed body is refused, even with a valid old signature", () => {
    const signature = sign(body, ts, secret);
    const r = verify({ rawBody: '{"events":[{"kind":"ledger.upsert"}]}', signature, timestamp: ts, secret });
    expect(r).toMatchObject({ ok: false, reason: "signature does not match" });
  });

  test("the timestamp is signed too, so a capture cannot be replayed later", () => {
    // The body and signature of a real request from an hour ago, re-sent with
    // a fresh timestamp to get past the window check.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const captured = sign(body, old, secret);
    const r = verify({ rawBody: body, signature: captured, timestamp: ts, secret });
    expect(r).toMatchObject({ ok: false, reason: "signature does not match" });
  });

  test("a stale timestamp is refused even when the signature is right", () => {
    const old = String(Math.floor(Date.now() / 1000) - (MAX_SKEW_SECONDS + 60));
    const r = verify({ rawBody: body, signature: sign(body, old, secret), timestamp: old, secret });
    expect(r).toMatchObject({ ok: false, reason: "timestamp is outside the accepted window" });
  });

  test("a missing header or secret is refused rather than ignored", () => {
    expect(verify({ rawBody: body, signature: null, timestamp: ts, secret })).toMatchObject({ ok: false });
    expect(verify({ rawBody: body, signature: sign(body, ts, secret), timestamp: null, secret })).toMatchObject({ ok: false });
    expect(verify({ rawBody: body, signature: sign(body, ts, secret), timestamp: ts, secret: "" })).toMatchObject({ ok: false });
  });
});

describe("the door", () => {
  // The sign-in gate in src/proxy.ts matches every path, and before this was
  // fixed it answered a signed sync request with a 307 to /login. A worker
  // following redirects would have read that as success and dropped the batch;
  // one that does not follow them would have seen a redirect it could not
  // explain. Either way the money never arrived, and nothing failed loudly.
  test("an API request with no cookie reaches the route instead of the login page", async () => {
    const { proxy } = await import("../src/proxy");
    const { NextRequest } = await import("next/server");
    const res = await proxy(new NextRequest(new URL("http://localhost/api/sync/wabmeta"), { method: "POST" }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  test("a page request with no cookie still goes to the login page", async () => {
    const { proxy } = await import("../src/proxy");
    const { NextRequest } = await import("next/server");
    const res = await proxy(new NextRequest(new URL("http://localhost/dashboard")));
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("the contract", () => {
  const ledger = {
    id: "evt_1",
    externalId: "payment:pay_abc",
    kind: "ledger.upsert",
    type: "in",
    date: "2026-10-01",
    description: "Growth plan",
    category: "WabMeta plan",
    amountPaise: 299900,
    status: "paid",
  };

  test("a well-formed batch parses", () => {
    expect(syncBody.safeParse({ events: [ledger] }).success).toBe(true);
  });

  test("an unknown kind is refused", () => {
    expect(syncBody.safeParse({ events: [{ ...ledger, kind: "member.delete" }] }).success).toBe(false);
  });

  test("money must be whole paise, never a float", () => {
    expect(syncBody.safeParse({ events: [{ ...ledger, amountPaise: 2999.5 }] }).success).toBe(false);
  });

  test("a date must be yyyy-MM-dd", () => {
    expect(syncBody.safeParse({ events: [{ ...ledger, date: "01/10/2026" }] }).success).toBe(false);
  });

  test("an empty batch is refused, so a worker bug is visible", () => {
    expect(syncBody.safeParse({ events: [] }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────── with database ───

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const suffix = Date.now().toString(36);
let tenantId = "";

const ONBOARDER = `onb-${suffix}`;
const ORG = `org-${suffix}`;

beforeAll(async () => {
  await expect(
    signup({
      name: "Priya Founder",
      email: `founder-wm-${suffix}@test.dev`,
      password: "correct horse battery",
      confirm: "correct horse battery",
      agree: true,
    }),
  ).rejects.toThrow("redirect:/dashboard");
  tenantId = (await getSigned())!.tenant.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await owner.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await owner.$disconnect();
});

const member = (over: Record<string, unknown> = {}) => ({
  id: `evt-m-${Math.random()}`,
  kind: "member.upsert" as const,
  externalId: ONBOARDER,
  name: "Ravi Sales",
  email: `ravi-${suffix}@wabmeta.test`,
  title: "Onboarder",
  ...over,
});

const client = (over: Record<string, unknown> = {}) => ({
  id: `evt-c-${Math.random()}`,
  kind: "client.upsert" as const,
  externalId: ORG,
  name: "Sharma Traders",
  company: "Sharma Traders Pvt Ltd",
  retainerPaise: 299900,
  ownerExternalId: ONBOARDER,
  ...over,
});

const payment = (over: Record<string, unknown> = {}) => ({
  id: `evt-p-${Math.random()}`,
  kind: "ledger.upsert" as const,
  externalId: `payment:pay_${suffix}`,
  type: "in" as const,
  date: "2026-10-01",
  description: "Growth plan — Sharma Traders",
  category: "WabMeta plan",
  amountPaise: 299900,
  status: "paid" as const,
  clientExternalId: ORG,
  method: "Razorpay",
  ...over,
});

describe("a sales person arriving from WabMeta", () => {
  test("is added to the team with no access at all", async () => {
    const [r] = await applyEvents(tenantId, [member()]);
    expect(r).toMatchObject({ status: "applied" });

    const row = await owner.member.findFirstOrThrow({ where: { tenantId, externalId: ONBOARDER } });
    expect(row.name).toBe("Ravi Sales");
    // Rule 2: a push from another system must not be able to grant anything.
    expect(row.features).toEqual({});
    expect(row.isOwner).toBe(false);
    expect(row.passwordHash).toBeNull();
    expect(await owner.clientGrant.count({ where: { memberId: row.id } })).toBe(0);
  });

  test("is not duplicated when the same event arrives again", async () => {
    const [r] = await applyEvents(tenantId, [member()]);
    expect(r).toMatchObject({ status: "unchanged" });
    expect(await owner.member.count({ where: { tenantId, externalId: ONBOARDER } })).toBe(1);
  });

  test("a rename over there is a rename here, not a second person", async () => {
    const [r] = await applyEvents(tenantId, [member({ name: "Ravi Kumar" })]);
    expect(r).toMatchObject({ status: "applied" });
    const rows = await owner.member.findMany({ where: { tenantId, externalId: ONBOARDER } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Ravi Kumar");
  });

  test("somebody already on the team with that address is adopted, not cloned", async () => {
    const email = `manual-${suffix}@wabmeta.test`;
    await owner.member.create({ data: { tenantId, name: "Added By Hand", email, title: "Designer" } });

    const [r] = await applyEvents(tenantId, [member({ externalId: `onb2-${suffix}`, name: "Added By Hand", email })]);
    expect(r).toMatchObject({ status: "applied" });

    const rows = await owner.member.findMany({ where: { tenantId, email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe(`onb2-${suffix}`);
    // A title set here is the team's own description of the person.
    expect(rows[0]!.title).toBe("Designer");
  });
});

describe("a client arriving from WabMeta", () => {
  test("is filed under the WabMeta brand and credited to its onboarder", async () => {
    const [r] = await applyEvents(tenantId, [client()]);
    expect(r).toMatchObject({ status: "applied" });

    const row = await owner.client.findFirstOrThrow({
      where: { tenantId, externalId: ORG },
      include: { brand: true, owner: true },
    });
    expect(row.brand.name).toBe(WABMETA_BRAND);
    expect(row.externalSource).toBe(SOURCE);
    expect(row.retainer).toBe(299900n);
    expect(row.owner?.externalId).toBe(ONBOARDER);
    // Credit is not access: being the onboarder grants no grant.
    expect(await owner.clientGrant.count({ where: { clientId: row.id } })).toBe(0);
  });

  test("a redelivery changes nothing", async () => {
    const [r] = await applyEvents(tenantId, [client()]);
    expect(r).toMatchObject({ status: "unchanged" });
    expect(await owner.client.count({ where: { tenantId, externalId: ORG } })).toBe(1);
  });

  test("an unknown onboarder leaves the client unowned rather than failing", async () => {
    const [r] = await applyEvents(tenantId, [
      client({ externalId: `org2-${suffix}`, name: "No Owner Ltd", ownerExternalId: "nobody" }),
    ]);
    expect(r).toMatchObject({ status: "applied" });
    const row = await owner.client.findFirstOrThrow({ where: { tenantId, externalId: `org2-${suffix}` } });
    expect(row.ownerMemberId).toBeNull();
  });

  test("closed over there means removed here, and the history stays", async () => {
    const [r] = await applyEvents(tenantId, [client({ removed: true })]);
    expect(r).toMatchObject({ status: "applied" });
    const row = await owner.client.findFirstOrThrow({ where: { tenantId, externalId: ORG } });
    expect(row.removedAt).not.toBeNull();

    // And back again, because a suspension can be lifted.
    await applyEvents(tenantId, [client()]);
    const again = await owner.client.findFirstOrThrow({ where: { tenantId, externalId: ORG } });
    expect(again.removedAt).toBeNull();
  });
});

describe("a sale handed to an onboarder", () => {
  const SELLER = `seller-${suffix}`;
  const SOLD = `sold-${suffix}`;

  test("names the seller as owner and the onboarder separately", async () => {
    await applyEvents(tenantId, [member({ externalId: SELLER, name: "Asha Sales", email: `asha-${suffix}@wabmeta.test`, title: "Sales" })]);
    const [r] = await applyEvents(tenantId, [
      client({ externalId: SOLD, name: "Sold Co", ownerExternalId: SELLER, onboarderExternalId: ONBOARDER }),
    ]);
    expect(r).toMatchObject({ status: "applied" });

    const row = await owner.client.findFirstOrThrow({
      where: { tenantId, externalId: SOLD },
      include: { owner: true, onboarder: true },
    });
    expect(row.owner?.externalId).toBe(SELLER);
    expect(row.onboarder?.externalId).toBe(ONBOARDER);
  });

  test("a redelivery is unchanged, and a different onboarder is a change", async () => {
    const [same] = await applyEvents(tenantId, [
      client({ externalId: SOLD, name: "Sold Co", ownerExternalId: SELLER, onboarderExternalId: ONBOARDER }),
    ]);
    expect(same).toMatchObject({ status: "unchanged" });

    const [moved] = await applyEvents(tenantId, [
      client({ externalId: SOLD, name: "Sold Co", ownerExternalId: SELLER, onboarderExternalId: null }),
    ]);
    expect(moved).toMatchObject({ status: "applied" });
    const row = await owner.client.findFirstOrThrow({ where: { tenantId, externalId: SOLD } });
    expect(row.onboarderMemberId).toBeNull();
    // The sale is untouched by whatever happens to the onboarding.
    expect(row.ownerMemberId).not.toBeNull();
  });

  test("a sender that predates the field still works", async () => {
    const [r] = await applyEvents(tenantId, [client({ externalId: `old-${suffix}`, name: "Old Sender Co" })]);
    expect(r).toMatchObject({ status: "applied" });
  });
});

describe("money", () => {
  test("a payment lands against its client, in paise", async () => {
    const [r] = await applyEvents(tenantId, [payment()]);
    expect(r).toMatchObject({ status: "applied" });

    const row = await owner.ledgerEntry.findFirstOrThrow({
      where: { tenantId, externalId: `payment:pay_${suffix}` },
      include: { client: true },
    });
    expect(row.amount).toBe(299900n);
    expect(row.type).toBe("in");
    expect(row.client?.externalId).toBe(ORG);
  });

  test("the same payment delivered ten times is still one row", async () => {
    // The property the whole design rests on. The 2026-10-02 wallet bug wrote
    // seven credit rows for one payment because this was not enforced.
    const results = await Promise.all(Array.from({ length: 10 }, () => applyEvent(tenantId, payment())));

    for (const r of results) {
      if (r.status === "failed") expect(r.retry).toBe(true);
      else expect(["applied", "unchanged"]).toContain(r.status);
    }

    const rows = await owner.ledgerEntry.findMany({ where: { tenantId, externalId: `payment:pay_${suffix}` } });
    expect(rows).toHaveLength(1);

    const total = await owner.ledgerEntry.aggregate({
      where: { tenantId, externalId: `payment:pay_${suffix}` },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(299900n);
  });

  test("a pending offline payment becomes paid in place, not twice", async () => {
    const id = `manual:mp_${suffix}`;
    await applyEvents(tenantId, [
      payment({ externalId: id, status: "pending", method: "UPI", description: "Offline top-up" }),
    ]);
    const [r] = await applyEvents(tenantId, [
      payment({ externalId: id, status: "paid", paidOn: "2026-10-02", method: "UPI", description: "Offline top-up" }),
    ]);
    expect(r).toMatchObject({ status: "applied" });

    const rows = await owner.ledgerEntry.findMany({ where: { tenantId, externalId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("paid");
    expect(rows[0]!.paidOn).not.toBeNull();
  });

  test("a payment for a client that has not arrived yet is held for retry", async () => {
    const [r] = await applyEvents(tenantId, [
      payment({ externalId: `payment:orphan_${suffix}`, clientExternalId: `never-synced-${suffix}` }),
    ]);
    expect(r).toMatchObject({ status: "failed", retry: true });
    expect(r.error).toContain("has not been synced yet");
    // Not filed as overhead, which would have been wrong for good.
    expect(await owner.ledgerEntry.count({ where: { tenantId, externalId: `payment:orphan_${suffix}` } })).toBe(0);
  });

  test("one bad event does not take the rest of the batch down", async () => {
    const good = `payment:batch_${suffix}`;
    const results = await applyEvents(tenantId, [
      payment({ externalId: `payment:orphan2_${suffix}`, clientExternalId: "missing" }),
      payment({ externalId: good, description: "Second instalment" }),
    ]);
    expect(results[0]).toMatchObject({ status: "failed", retry: true });
    expect(results[1]).toMatchObject({ status: "applied" });
    expect(await owner.ledgerEntry.count({ where: { tenantId, externalId: good } })).toBe(1);
  });

  test("the category reaches the workspace's list, so reports can group by it", async () => {
    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t.incomeCategories).toContain("WabMeta plan");
  });

  test("a refund is its own entry out, not an edit of the payment", async () => {
    const [r] = await applyEvents(tenantId, [
      payment({
        externalId: `refund:pay_${suffix}`,
        type: "out",
        description: "Refund — Sharma Traders",
        category: "WabMeta refund",
        amountPaise: 50000,
      }),
    ]);
    expect(r).toMatchObject({ status: "applied" });

    const paid = await owner.ledgerEntry.findFirstOrThrow({ where: { tenantId, externalId: `payment:pay_${suffix}` } });
    expect(paid.amount).toBe(299900n);

    const refund = await owner.ledgerEntry.findFirstOrThrow({ where: { tenantId, externalId: `refund:pay_${suffix}` } });
    expect(refund.type).toBe("out");
    expect(refund.amount).toBe(50000n);

    const t = await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t.expenseCategories).toContain("WabMeta refund");
  });
});

describe("the trail", () => {
  test("every synced change is recorded, named as the sync", async () => {
    const entries = await owner.auditEntry.findMany({ where: { tenantId, actorName: "WabMeta sync" } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.actorId === null)).toBe(true);
    expect(entries.some((e) => e.kind === "client")).toBe(true);
    expect(entries.some((e) => e.kind === "team")).toBe(true);
  });
});
