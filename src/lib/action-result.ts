import { ZodError } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** An error whose message is safe to show the user. */
export class UserError extends Error {
  name = "UserError";
}

export function toActionError(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: err.issues[0]?.message ?? "Please check the form.", fieldErrors };
  }
  if (err instanceof Error && (err.name === "UserError" || err.name === "AccessError")) {
    return { ok: false, error: err.message };
  }
  // Let Next.js redirect/notFound control flow through.
  if (err && typeof err === "object" && "digest" in err) throw err;
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}
