import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { tenantTransaction } from "./db";

/**
 * Receiving what WabMeta pushes.
 *
 * WabMeta owns the clients, the sales team that brought them in, and the money
 * they paid. It writes an event into its own outbox inside the same
 * transaction as the change, and a worker posts the events here. This module
 * is the other end: it checks the signature, reads the event, and writes it.
 *
 * Three rules shape everything below.
 *
 *   1. EVERY EVENT CAN ARRIVE TWICE. A retry after a timeout that in fact
 *      succeeded, a redeploy mid-flight, a worker that ran twice — push has no
 *      way to promise otherwise. So every write is keyed on the id the row has
 *      in WabMeta (`externalId`, unique per tenant) and is an upsert. Applying
 *      the same event ten times leaves the same single row.
 *
 *   2. THE SYNC GRANTS ALMOST NOTHING. A WabMeta admin arriving here becomes a
 *      member with no features, no password and no grants — somebody on the
 *      team list and nothing more. The one exception: the person WabMeta
 *      assigns to a client (its seller or its onboarder) gets Edit on that
 *      client, never Finance, when the assignment is new. They still cannot
 *      sign in or open a screen until an owner sets a password and features.
 *
 *   3. ONE EVENT, ONE TRANSACTION. Events are applied one at a time and
 *      reported separately, so a payment whose client has not arrived yet
 *      fails alone and nothing else in the batch is lost. WabMeta then retries
 *      that one event.
 */

// ─────────────────────────────────────────────────────────── the signature ───

export const SIGNATURE_HEADER = "x-wabmeta-signature";
export const TIMESTAMP_HEADER = "x-wabmeta-timestamp";

/** How far out of date a request may be. Beyond this it is treated as a replay. */
export const MAX_SKEW_SECONDS = 300;

/**
 * The signature for a body. The timestamp is inside the signed string rather
 * than beside it, so a captured body cannot be replayed with its clock moved
 * forward: changing the timestamp invalidates the signature.
 */
export function sign(rawBody: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether this request really came from WabMeta, and is recent.
 *
 * The comparison is length-checked and then timing-safe: `timingSafeEqual`
 * throws on a length mismatch rather than returning false, and a plain `===`
 * on a hex digest leaks how much of a guess was right.
 */
export function verify(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now?: Date;
}): VerifyResult {
  const { rawBody, signature, timestamp, secret } = input;
  if (!secret) return { ok: false, reason: "no signing secret is configured" };
  if (!signature) return { ok: false, reason: `missing ${SIGNATURE_HEADER}` };
  if (!timestamp) return { ok: false, reason: `missing ${TIMESTAMP_HEADER}` };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "timestamp is not a number" };

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - sent) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp is outside the accepted window" };
  }

  const expected = Buffer.from(sign(rawBody, timestamp, secret), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "signature does not match" };
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────── the contract ───

/** The brand every WabMeta client is filed under. Created on the first sync. */
export const WABMETA_BRAND = "WabMeta";
/** Written to `clients.externalSource`, so these rows are recognisable. */
export const SOURCE = "wabmeta";

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a yyyy-MM-dd date");

/**
 * Money arrives as whole paise. A JS integer is exact to 2^53, which is ninety
 * trillion rupees, so the wire format loses nothing; it becomes a BigInt before
 * it reaches the database, where the column is 64-bit.
 */
const paise = z.number().int();

const base = { id: z.string().min(1), externalId: z.string().min(1) };

/**
 * A person on the WabMeta admin team — an onboarder, or whoever else belongs on
 * the TeamOS team list. Deliberately carries no role or permission: see rule 2.
 */
export const memberEvent = z.object({
  ...base,
  kind: z.literal("member.upsert"),
  name: z.string().min(1),
  email: z.string().email().nullish(),
  title: z.string().min(1).nullish(),
});

/** A WabMeta organization, as a TeamOS client. */
export const clientEvent = z.object({
  ...base,
  kind: z.literal("client.upsert"),
  name: z.string().min(1),
  company: z.string().nullish(),
  contact: z.string().nullish(),
  since: dayString.nullish(),
  /** The plan plus monthly add-ons, in paise. */
  retainerPaise: paise.nonnegative().nullish(),
  /**
   * Who brought the client in - the sales person who sold it, or the onboarder
   * who created it alone. An unknown id leaves the client unowned.
   */
  ownerExternalId: z.string().nullish(),
  /**
   * Who is onboarding it, once a sale has been handed over. Optional on the
   * wire, so a sender that predates the field keeps working.
   */
  onboarderExternalId: z.string().nullish(),
  /**
   * The client's account, as WabMeta knows it. Each is optional on the wire:
   * absent means "this sender does not send it", and leaves the stored value
   * alone rather than blanking it.
   */
  loginId: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  plan: z.string().max(120).nullish(),
  /** True once the organization is closed or deleted over there. */
  removed: z.boolean().nullish(),
});

/**
 * One movement of money. WabMeta decides what counts — plan payments, refunds,
 * wallet top-ups, verified offline payments — and sends each as its own row
 * with its own id, so nothing here re-derives revenue and the sources cannot
 * overlap or be counted twice.
 */
export const ledgerEvent = z.object({
  ...base,
  kind: z.literal("ledger.upsert"),
  type: z.enum(["in", "out"]),
  date: dayString,
  description: z.string().min(1),
  category: z.string().min(1),
  amountPaise: paise.nonnegative(),
  status: z.enum(["paid", "pending"]),
  paidOn: dayString.nullish(),
  method: z.string().nullish(),
  /** Null means money that belongs to no client. */
  clientExternalId: z.string().nullish(),
  note: z.string().nullish(),
});

export const syncEvent = z.discriminatedUnion("kind", [memberEvent, clientEvent, ledgerEvent]);
export const syncBody = z.object({ events: z.array(syncEvent).min(1).max(200) });

export type SyncEvent = z.infer<typeof syncEvent>;
export type MemberEvent = z.infer<typeof memberEvent>;
export type ClientEvent = z.infer<typeof clientEvent>;
export type LedgerEvent = z.infer<typeof ledgerEvent>;

// ─────────────────────────────────────────────────────────────── applying ───

/**
 * What happened to one event.
 *
 * `applied` and `unchanged` both mean WabMeta can stop retrying — the second is
 * a redelivery that found the row already right. `failed` with `retry: true` is
 * worth sending again (a payment whose client has not arrived yet will work on
 * the next attempt); `failed` without it never will.
 */
export type EventResult = {
  id: string;
  status: "applied" | "unchanged" | "failed";
  retry?: boolean;
  error?: string;
};

/** The transaction handle `tenantTransaction` hands its callback. */
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const trim = (v: string | null | undefined) => (v == null ? null : v.trim() || null);

/** A failure WabMeta should send again later. */
class Later extends Error {}

/**
 * Applies one event, in its own transaction.
 *
 * Never throws: every outcome becomes an `EventResult`, because the caller
 * reports per event and one bad row must not take the batch down with it.
 */
export async function applyEvent(tenantId: string, event: SyncEvent): Promise<EventResult> {
  try {
    switch (event.kind) {
      case "member.upsert":
        return await tenantTransaction(tenantId, (tx) => applyMember(tx, tenantId, event));
      case "client.upsert":
        return await tenantTransaction(tenantId, (tx) => applyClient(tx, tenantId, event));
      case "ledger.upsert":
        return await tenantTransaction(tenantId, (tx) => applyLedger(tx, tenantId, event));
    }
  } catch (err) {
    return {
      id: event.id,
      status: "failed",
      // A unique-constraint collision means two deliveries of the same event
      // raced; the winner wrote the row, so trying once more will find it and
      // report `unchanged`.
      retry: err instanceof Later || isUniqueViolation(err),
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/** Applies a batch one event at a time, in the order given. */
export async function applyEvents(tenantId: string, events: SyncEvent[]): Promise<EventResult[]> {
  const results: EventResult[] = [];
  for (const event of events) results.push(await applyEvent(tenantId, event));
  return results;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

/**
 * The brand WabMeta clients are filed under.
 *
 * An upsert rather than find-then-create, so two events arriving together
 * cannot both decide the brand is missing. `clients.brandId` is not nullable,
 * which is why this has to exist before any client can be written.
 */
async function wabmetaBrand(tx: Tx, tenantId: string) {
  return tx.brand.upsert({
    where: { tenantId_name: { tenantId, name: WABMETA_BRAND } },
    create: { tenantId, name: WABMETA_BRAND, kind: "agency" },
    update: {},
    select: { id: true },
  });
}

/**
 * Who a synced ledger entry is recorded against.
 *
 * `createdById` is not nullable, and honestly the person who recorded a synced
 * payment is WabMeta, not anybody on the team. The workspace's first owner
 * stands in; `method` and the audit entry say where the money came from.
 */
async function recordingOwner(tx: Tx) {
  const owner = await tx.member.findFirst({
    where: { isOwner: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) throw new Later("this workspace has no owner to record the entry against");
  return owner;
}

// ── members ────────────────────────────────────────────────────────────────

async function applyMember(tx: Tx, tenantId: string, e: MemberEvent): Promise<EventResult> {
  const email = trim(e.email)?.toLowerCase() ?? null;
  const name = e.name.trim();

  const byExternal = await tx.member.findFirst({ where: { externalId: e.externalId } });

  // Somebody may already be on the team with this address, added by hand
  // before the sync existed. Adopt that row rather than failing on the email
  // unique index or leaving two copies of one person on the list.
  const existing = byExternal ?? (email ? await tx.member.findFirst({ where: { email, externalId: null } }) : null);

  if (existing) {
    if (existing.name === name && existing.email === email && existing.externalId === e.externalId) {
      return { id: e.id, status: "unchanged" };
    }
    // `title` is left alone on an existing row: a job title set in TeamOS is
    // the team's own description of the person, not WabMeta's.
    await tx.member.update({ where: { id: existing.id }, data: { name, email, externalId: e.externalId } });
    await log(tx, tenantId, {
      kind: "team",
      text: existing.externalId ? `updated ${name} from WabMeta` : `linked ${name} to WabMeta`,
      target: "Team",
      area: "team",
    });
    return { id: e.id, status: "applied" };
  }

  // New people arrive with no features and no password: on the team list,
  // unable to sign in or see anything until an owner says otherwise.
  await tx.member.create({
    data: {
      tenantId,
      name,
      email,
      title: trim(e.title) ?? "Team member",
      externalId: e.externalId,
      features: {},
    },
  });
  await log(tx, tenantId, { kind: "team", text: `added ${name} from WabMeta`, target: "Team", area: "team" });
  return { id: e.id, status: "applied" };
}

// ── clients ────────────────────────────────────────────────────────────────

async function applyClient(tx: Tx, tenantId: string, e: ClientEvent): Promise<EventResult> {
  const name = e.name.trim();
  const company = trim(e.company) ?? "";
  const contact = trim(e.contact) ?? "";
  const retainer = BigInt(e.retainerPaise ?? 0);
  const since = e.since ? day(e.since) : null;

  // An unknown owner is not a failure: the client is worth having even before
  // its onboarder has been pushed, and the next client event links it up.
  const owner = e.ownerExternalId
    ? await tx.member.findFirst({ where: { externalId: e.ownerExternalId }, select: { id: true } })
    : null;
  const ownerMemberId = owner?.id ?? null;

  // Same rule as the owner: an onboarder who has not arrived yet leaves the
  // field empty, and the next client event fills it.
  const onboarder = e.onboarderExternalId
    ? await tx.member.findFirst({ where: { externalId: e.onboarderExternalId }, select: { id: true } })
    : null;
  const onboarderMemberId = onboarder?.id ?? null;

  const existing = await tx.client.findFirst({ where: { externalId: e.externalId } });
  const removedAt = e.removed ? (existing?.removedAt ?? new Date()) : null;

  // Only what the sender sent. `undefined` keeps the stored value, so an older
  // sender cannot wipe a login it never knew about.
  const account = {
    ...(e.loginId !== undefined && { loginId: trim(e.loginId) ?? "" }),
    ...(e.phone !== undefined && { phone: trim(e.phone) ?? "" }),
    ...(e.plan !== undefined && { plan: trim(e.plan) ?? "" }),
  };

  if (existing) {
    const same =
      existing.name === name &&
      existing.company === company &&
      existing.contact === contact &&
      existing.retainer === retainer &&
      existing.ownerMemberId === ownerMemberId &&
      existing.onboarderMemberId === onboarderMemberId &&
      (account.loginId === undefined || existing.loginId === account.loginId) &&
      (account.phone === undefined || existing.phone === account.phone) &&
      (account.plan === undefined || existing.plan === account.plan) &&
      (existing.removedAt === null) === (removedAt === null);
    if (same) return { id: e.id, status: "unchanged" };

    await tx.client.update({
      where: { id: existing.id },
      data: { name, company, contact, retainer, sinceDate: since, ownerMemberId, onboarderMemberId, removedAt, ...account },
    });
    await log(tx, tenantId, {
      kind: "client",
      text: e.removed ? `removed ${name} in WabMeta` : `updated ${name} from WabMeta`,
      target: name,
      clientId: existing.id,
    });
    // Only somebody newly assigned. Re-granting on every change would undo an
    // owner who took the access away on the Access screen.
    const newly = [
      ownerMemberId !== existing.ownerMemberId ? ownerMemberId : null,
      onboarderMemberId !== existing.onboarderMemberId ? onboarderMemberId : null,
    ];
    await grantAssigned(tx, tenantId, existing.id, name, newly);
    return { id: e.id, status: "applied" };
  }

  const brand = await wabmetaBrand(tx, tenantId);
  const created = await tx.client.create({
    data: {
      tenantId,
      brandId: brand.id,
      name,
      company,
      contact,
      retainer,
      sinceDate: since,
      ownerMemberId,
      onboarderMemberId,
      removedAt,
      ...account,
      externalSource: SOURCE,
      externalId: e.externalId,
    },
    select: { id: true },
  });
  await log(tx, tenantId, { kind: "client", text: `added ${name} from WabMeta`, target: name, clientId: created.id });
  await grantAssigned(tx, tenantId, created.id, name, [ownerMemberId, onboarderMemberId]);
  return { id: e.id, status: "applied" };
}

/**
 * Lets the people WabMeta assigns to a client open it here: Edit, never
 * Finance. A seller or onboarder in WabMeta works on exactly these clients, and
 * without this they signed in to TeamOS and found an empty client list.
 *
 * skipDuplicates, so an existing grant - Finance included - is never lowered
 * or changed. The caller passes only people newly assigned, so access an owner
 * removed stays removed until WabMeta assigns that person again.
 */
async function grantAssigned(tx: Tx, tenantId: string, clientId: string, name: string, memberIds: (string | null)[]) {
  const ids = [...new Set(memberIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const { count } = await tx.clientGrant.createMany({
    data: ids.map((memberId) => ({ tenantId, memberId, clientId, level: "edit" })),
    skipDuplicates: true,
  });
  if (count) {
    await log(tx, tenantId, {
      kind: "client",
      text: `gave Edit access to ${name} to the ${count === 1 ? "person" : "people"} WabMeta assigned to it`,
      target: name,
      clientId,
    });
  }
}

// ── money ──────────────────────────────────────────────────────────────────

async function applyLedger(tx: Tx, tenantId: string, e: LedgerEvent): Promise<EventResult> {
  const amount = BigInt(e.amountPaise);
  const description = e.description.trim();
  const category = e.category.trim();
  const method = trim(e.method);
  const note = trim(e.note);
  const date = day(e.date);
  const paidOn = e.paidOn ? day(e.paidOn) : null;

  let clientId: string | null = null;
  if (e.clientExternalId) {
    const client = await tx.client.findFirst({ where: { externalId: e.clientExternalId }, select: { id: true } });
    // Unlike an unknown owner, an unknown client is worth waiting for: filing
    // the money against nobody would quietly turn it into overhead, and the
    // client's totals would then be wrong for good.
    if (!client) throw new Later(`client ${e.clientExternalId} has not been synced yet`);
    clientId = client.id;
  }

  // So the category appears in the filters and the reports, rather than
  // existing only on rows nobody can group by.
  await ensureCategory(tx, tenantId, e.type, category);

  const existing = await tx.ledgerEntry.findFirst({ where: { externalId: e.externalId } });

  if (existing) {
    const same =
      existing.type === e.type &&
      existing.amount === amount &&
      existing.status === e.status &&
      existing.description === description &&
      existing.category === category &&
      existing.clientId === clientId &&
      existing.date.getTime() === date.getTime();
    if (same) return { id: e.id, status: "unchanged" };

    // The same row, corrected — a pending offline payment that was verified,
    // or an amount WabMeta restated. Never a second row: that is exactly what
    // the unique index on (tenantId, externalId) exists to prevent.
    const settled = existing.status === "pending" && e.status === "paid";
    await tx.ledgerEntry.update({
      where: { id: existing.id },
      data: { type: e.type, date, description, category, amount, status: e.status, paidOn, method, note, clientId },
    });
    if (settled) {
      await log(tx, tenantId, {
        kind: "expense",
        text: `${description} was settled in WabMeta`,
        target: description,
        clientId,
        area: clientId ? null : "import",
      });
    }
    return { id: e.id, status: "applied" };
  }

  const owner = await recordingOwner(tx);
  await tx.ledgerEntry.create({
    data: {
      tenantId,
      type: e.type,
      date,
      description,
      category,
      amount,
      status: e.status,
      paidOn,
      method,
      note,
      clientId,
      externalId: e.externalId,
      createdById: owner.id,
    },
  });
  await log(tx, tenantId, {
    kind: "expense",
    text: `${description} recorded from WabMeta`,
    target: description,
    clientId,
    area: clientId ? null : "import",
  });
  return { id: e.id, status: "applied" };
}

/** Adds a category to the workspace's list the first time it is used. */
async function ensureCategory(tx: Tx, tenantId: string, type: "in" | "out", category: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { incomeCategories: true, expenseCategories: true },
  });
  if (!tenant) throw new Later("the workspace named by WABMETA_TENANT_ID does not exist");

  if (type === "in") {
    if (tenant.incomeCategories.includes(category)) return;
    await tx.tenant.update({ where: { id: tenantId }, data: { incomeCategories: { push: category } } });
  } else {
    if (tenant.expenseCategories.includes(category)) return;
    await tx.tenant.update({ where: { id: tenantId }, data: { expenseCategories: { push: category } } });
  }
}

/**
 * The trail. Written in the same transaction as the change, as every other
 * write in this app is, so there is never a change without its record.
 */
async function log(
  tx: Tx,
  tenantId: string,
  entry: {
    kind: "team" | "client" | "expense";
    text: string;
    target: string;
    clientId?: string | null;
    area?: "team" | "import" | null;
  },
) {
  await tx.auditEntry.create({
    data: {
      tenantId,
      actorId: null,
      actorName: "WabMeta sync",
      kind: entry.kind,
      text: entry.text,
      target: entry.target,
      clientId: entry.clientId ?? null,
      area: entry.area ?? null,
    },
  });
}
