import "server-only";
import type { Member, Prisma, PrismaClient } from "@prisma/client";
import { getSigned, type Signed } from "./auth";
import { tenantTransaction } from "./db";
import { canEdit, featureLevel, featureName, type Feature, type Level } from "./access";
import { nowIn, todayIn } from "./format";
import type { AuditKind, AuditW, Collections, Patch, Result } from "./types";
import { asPerson, auditVisible, grantMap, mapAudit, reachOf, type Reach, type Viewer } from "./workspace";

/**
 * Every write in the application goes through `mutate`.
 *
 * It establishes who is asking (fresh from the database), refuses writes while
 * an owner is previewing someone else's access, opens one transaction bound to
 * the tenant, and hands the handler what it needs to check permissions and to
 * record what it did. The audit entry is written in the same transaction as the
 * change, so there is never a change without its record or a record without
 * its change.
 *
 * Handlers return the records they touched; the browser applies them in place
 * instead of reloading the whole workspace.
 */

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class UserError extends Error {
  constructor(
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export type AuditInput = {
  kind: AuditKind;
  text: string;
  target: string;
  clientId?: string | null;
  area?: "team" | "payroll" | "ledger" | "access" | "tasks" | "import" | "brands" | null;
  from?: string;
  to?: string;
};

export type Ctx = {
  signed: Signed;
  tenantId: string;
  tz: string;
  today: string;
  me: Member;
  person: Viewer;
  reach: Reach;
  tx: Tx;
  /** Refuses unless the caller holds `level` on `feature`. */
  need: (feature: Feature, level?: Level) => void;
  /** A refusal the caller can read, optionally pinned to form fields. */
  fail: (message: string, fields?: Record<string, string>) => never;
  log: (entry: AuditInput) => Promise<void>;
  upsert: <K extends keyof Collections>(collection: K, items: Collections[K]) => void;
  remove: (collection: keyof Collections, ids: string[]) => void;
  tenantPatch: (fields: Patch["tenant"]) => void;
};

export async function mutate<T = undefined>(
  fn: (ctx: Ctx) => Promise<string | { message?: string; data?: T } | void>,
  options: { timeout?: number } = {},
): Promise<Result<T>> {
  try {
    const signed = await getSigned();
    if (!signed) return { ok: false, error: "Your session has ended. Please log in again." };
    if (signed.previewing) {
      return {
        ok: false,
        error: `You are previewing as ${signed.viewer.name}. Go back to your own view to make changes.`,
      };
    }

    const { tenant, me } = signed;
    const tz = tenant.timezone;
    const patch: Patch = {};
    const audits: AuditW[] = [];

    const outcome = await tenantTransaction(tenant.id, async (tx) => {
      // Fresh, inside the transaction: a grant changed a second ago counts.
      const [self, grants] = await Promise.all([
        tx.member.findUniqueOrThrow({ where: { id: me.id } }),
        tx.clientGrant.findMany(),
      ]);
      const person = asPerson(self);
      const reach = reachOf(person, grantMap(grants));

      const fail = (message: string, fields?: Record<string, string>): never => {
        throw new UserError(message, fields);
      };

      const ctx: Ctx = {
        signed,
        tenantId: tenant.id,
        tz,
        today: todayIn(tz),
        me: self,
        person,
        reach,
        tx,
        fail,
        need: (feature, level = "edit") => {
          const held = featureLevel(person, feature);
          const ok = level === "view" ? held !== "none" : held === "edit";
          if (!ok) {
            fail(
              level === "edit" && held === "view"
                ? `You have view-only access to ${featureName(feature)}. Nothing was saved.`
                : `You don't have access to ${featureName(feature)}.`,
            );
          }
        },
        log: async (e) => {
          const row = await tx.auditEntry.create({
            data: {
              tenantId: tenant.id,
              actorId: self.id,
              actorName: self.name,
              kind: e.kind,
              text: e.text,
              target: e.target,
              clientId: e.clientId ?? null,
              area: e.area ?? null,
              fromValue: e.from ?? "",
              toValue: e.to ?? "",
            },
          });
          if (auditVisible(reach, row)) audits.push(mapAudit(row, tz));
        },
        upsert: (collection, items) => {
          patch.upsert ??= {};
          const existing = (patch.upsert[collection] ?? []) as Collections[typeof collection];
          (patch.upsert as Record<string, unknown[]>)[collection] = [...existing, ...items];
        },
        remove: (collection, ids) => {
          patch.remove ??= {};
          patch.remove[collection] = [...(patch.remove[collection] ?? []), ...ids];
        },
        tenantPatch: (fields) => {
          patch.tenant = { ...patch.tenant, ...fields };
        },
      };
      return fn(ctx);
    }, { timeout: options.timeout ?? 20_000, maxWait: 10_000 });

    if (audits.length) {
      patch.upsert ??= {};
      patch.upsert.audit = [...(patch.upsert.audit ?? []), ...audits];
    }

    const message = typeof outcome === "string" ? outcome : outcome?.message;
    const data = typeof outcome === "object" && outcome ? outcome.data : undefined;
    return { ok: true, patch, ...(message ? { message } : {}), ...(data !== undefined ? { data } : {}) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message, ...(err.fields ? { fields: err.fields } : {}) };
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (isUniqueViolation(err)) return { ok: false, error: "That already exists." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

/** Shared by handlers that only need "can this person edit that section". */
export const edits = (ctx: Ctx, feature: Feature) => canEdit(ctx.person, feature);

/** The current time as the screens write it. */
export const stamp = (ctx: Ctx) => nowIn(ctx.tz);

export type { Prisma };
