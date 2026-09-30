import "server-only";
import { ZodError, type ZodType } from "zod";
import { db, tenantDb, type TenantClient } from "./db";
import { getScope, type CurrentUser } from "./auth";
import type { PermissionKey } from "./permissions";
import { NotFoundError, PermissionError, requirePermission, type Scope } from "./scope";

/**
 * Every server action is declared through this wrapper, and the wrapper cannot
 * be used without naming the permission it requires — `permission` is a
 * required field, so an action that forgets to declare one does not compile.
 * That is this codebase's version of "a route with no decorator fails closed".
 *
 * The wrapper also hands the handler a database client already bound to the
 * caller's tenant, and the scope object every repository function demands. An
 * action therefore cannot reach the database without having said, in its own
 * signature, who is asking and what they are allowed to do.
 */

export type ActionSuccess<T = undefined> = { ok: true; data?: T; message?: string };

/** Split out because a refusal is a type in its own right: toActionError can
 *  only ever produce one, and saying so lets callers read .code without a
 *  narrowing step that would always succeed. */
export type ActionFailure = {
  ok: false;
  error: string;
  code: ActionErrorCode;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T = undefined> = ActionSuccess<T> | ActionFailure;

export type ActionErrorCode = "unauthenticated" | "denied" | "not_found" | "invalid" | "conflict" | "error";

/**
 * An error whose message is safe to show the person who triggered it.
 *
 * `fieldErrors` is for rules a schema cannot express — a name that collides, a
 * custom field whose definition lives in another table. Those belong next to
 * the offending input just as much as a Zod failure does, so they travel in the
 * same shape rather than as a banner above the form.
 */
export class UserError extends Error {
  name = "UserError";
  constructor(
    message: string,
    public readonly code: ActionErrorCode = "conflict",
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export type ActionContext = {
  user: CurrentUser;
  scope: Scope;
  /** Bound to the caller's tenant; row-level security is already applied. */
  db: TenantClient;
  /** Records what changed. The entry is written in the same request. */
  audit: (entry: AuditInput) => Promise<void>;
};

export type AuditInput = {
  action: string;
  resourceType: string;
  resourceId: string;
  resourceLabel?: string;
  before?: unknown;
  after?: unknown;
};

export function defineAction<TInput, TOutput>(config: {
  /** Required. There is no default and no "public" option by design. */
  permission: PermissionKey;
  input?: ZodType<TInput>;
  handler: (ctx: ActionContext, input: TInput) => Promise<ActionResult<TOutput>>;
}): (raw: TInput) => Promise<ActionResult<TOutput>> {
  return async (raw: TInput) => {
    try {
      const resolved = await getScope();
      if (!resolved) return { ok: false, error: "Please sign in again.", code: "unauthenticated" };

      const { user, scope } = resolved;

      // The redirect in requireScope() covers navigation; this covers the case
      // that matters, which is an action invoked directly.
      if (user.twoFactorPending) {
        return {
          ok: false,
          code: "denied",
          error: `Two-step verification is required for ${scope.roleName}s. Set it up in Security first.`,
        };
      }

      requirePermission(scope, config.permission);

      const input = config.input ? config.input.parse(raw) : raw;
      const pending: AuditInput[] = [];

      const result = await config.handler(
        {
          user,
          scope,
          db: tenantDb(user.tenantId),
          audit: async (entry) => {
            pending.push(entry);
          },
        },
        input,
      );

      if (result.ok && pending.length) await writeAudit(user, pending);
      return result;
    } catch (err) {
      return toActionError(err);
    }
  };
}

async function writeAudit(user: CurrentUser, entries: AuditInput[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, TRUE)`;
    await tx.auditEntry.createMany({
      data: entries.map((e) => ({
        tenantId: user.tenantId,
        actorId: user.id,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        resourceLabel: e.resourceLabel ?? null,
        before: (e.before ?? null) as never,
        after: (e.after ?? null) as never,
      })),
    });
  });
}

export function toActionError(err: unknown): ActionFailure {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, code: "invalid", error: err.issues[0]?.message ?? "Please check the form.", fieldErrors };
  }
  // Out of scope and never existed are deliberately indistinguishable.
  if (err instanceof NotFoundError) return { ok: false, code: "not_found", error: "Not found." };
  if (err instanceof PermissionError) return { ok: false, code: "denied", error: err.message };
  if (err instanceof UserError) {
    return { ok: false, code: err.code, error: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) };
  }
  if (err && typeof err === "object" && "digest" in err) throw err; // redirect / notFound
  console.error(err);
  return { ok: false, code: "error", error: "Something went wrong. Please try again." };
}
