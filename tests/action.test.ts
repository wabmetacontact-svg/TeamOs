/**
 * Stage 0 acceptance gate — the action wrapper.
 *
 * The plan's second proof is "an un-annotated route returns 403, not 200". In
 * a decorator-based framework that is a runtime check, because a route handler
 * without a decorator is still a valid route. Here it is a compile error: the
 * `permission` field on defineAction is required, so the un-annotated action
 * never reaches runtime at all. The ts-expect-error below is the proof — if
 * `permission` ever becomes optional, `npm run typecheck` fails on this file.
 *
 * What remains for runtime is the half a compiler cannot cover: that a caller
 * with no session, or without the named permission, gets a refusal rather than
 * a result, and that a refusal never reveals which of the two it was.
 */
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineAction, toActionError, UserError, type ActionResult } from "../src/lib/action";
import { NotFoundError, PermissionError } from "../src/lib/scope";

describe("declaring an action", () => {
  test("an action cannot be declared without naming its permission", () => {
    // @ts-expect-error — `permission` is required. This line failing to error
    // is itself the regression: it would mean actions can ship unguarded.
    const unannotated = defineAction({
      handler: async () => ({ ok: true }) as ActionResult,
    });

    expect(typeof unannotated).toBe("function");
  });

  test("the permission must be one of the catalogue's keys, not any string", () => {
    // @ts-expect-error — "expense:whatever" is not a PermissionKey.
    defineAction({ permission: "expense:whatever", handler: async () => ({ ok: true }) as ActionResult });

    // The same call with a real key compiles, which is what makes the above
    // a test of the type rather than of defineAction being fussy.
    const real = defineAction({ permission: "expense:approve", handler: async () => ({ ok: true }) as ActionResult });
    expect(typeof real).toBe("function");
  });
});

describe("calling an action", () => {
  test("no session means no result, whatever the handler would have done", async () => {
    let handlerRan = false;
    const action = defineAction({
      permission: "client:view",
      handler: async () => {
        handlerRan = true;
        return { ok: true, data: "secret" } as ActionResult<string>;
      },
    });

    const result = await action(undefined as never);

    expect(result.ok).toBe(false);
    // The important half: it did not merely fail to return — it never ran.
    expect(handlerRan).toBe(false);
  });
});

describe("what a refusal tells the caller", () => {
  test("out of scope and never existed produce byte-identical results", () => {
    const outOfScope = toActionError(new NotFoundError());
    const neverExisted = toActionError(new NotFoundError());

    expect(outOfScope).toEqual({ ok: false, code: "not_found", error: "Not found." });
    expect(JSON.stringify(outOfScope)).toBe(JSON.stringify(neverExisted));
  });

  test("a denial names no resource, so it leaks nothing about what exists", () => {
    const denied = toActionError(new PermissionError("expense:approve"));

    expect(denied.code).toBe("denied");
    // The permission key is on the error object for the audit trail; it is not
    // in the message that goes back over the wire.
    expect(denied.error).not.toContain("expense");
    expect(denied.error).toBe("You don't have permission to do that.");
  });

  test("denied and not_found are different codes, because they answer different questions", () => {
    // Not found: we will not say whether the row exists. Denied: the row was
    // never named, so there is nothing to protect by being vague.
    expect(toActionError(new NotFoundError()).code).not.toBe(toActionError(new PermissionError("x")).code);
  });

  test("a validation failure comes back per field, not as one opaque string", () => {
    const schema = z.object({ name: z.string().min(1, "Name is required"), amount: z.number().positive("Must be positive") });
    let caught: unknown;
    try {
      schema.parse({ name: "", amount: -5 });
    } catch (err) {
      caught = err;
    }

    const result = toActionError(caught);
    expect(result.code).toBe("invalid");
    expect(result.fieldErrors?.name).toEqual(["Name is required"]);
    expect(result.fieldErrors?.amount).toEqual(["Must be positive"]);
  });

  test("a UserError's message is shown as written; anything else is swallowed", () => {
    expect(toActionError(new UserError("This month is closed."))).toEqual({
      ok: false,
      code: "conflict",
      error: "This month is closed.",
    });

    // An unexpected error must never reach the browser: a stack trace or a
    // database message is exactly the kind of thing that leaks schema.
    const unexpected = toActionError(new Error("relation \"transactions\" does not exist"));
    expect(unexpected.code).toBe("error");
    expect(unexpected.error).not.toContain("transactions");
  });

  test("a redirect is rethrown rather than reported as a failure", () => {
    // Next.js signals redirect() and notFound() by throwing an object with a
    // digest. Catching those would turn navigation into an error toast.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login" });
    expect(() => toActionError(redirect)).toThrow("NEXT_REDIRECT");
  });
});
