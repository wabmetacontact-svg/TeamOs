/**
 * A source-level guard against the bug that has now happened five times.
 *
 * Every tenant-owned table is behind row-level security, which needs
 * `app.tenant_id` to be set. The raw Prisma client does not set it. So a query
 * written as `db.user.findFirst(...)` compiles, type-checks, lints clean, and
 * returns **nothing** — not an error, nothing — and whatever is above it
 * reports "wrong password", or "not found", or "something went wrong".
 *
 * Where it has bitten:
 *
 *   1. RLS itself, inert because Neon's owner role carries BYPASSRLS
 *   2. clientWhere, where a spread let a caller's id replace the scope filter
 *   3. the same spread in pipelineSummary
 *   4. every auth query, so no login could ever succeed
 *   5. the two-factor setup actions, so an Owner could not switch it on
 *
 * Four of those were invisible to tsc, to eslint, and to 200 passing tests.
 * The only thing that has ever caught them is querying as the restricted role
 * — which is what the other suites now do — and this, which catches them
 * before they are written.
 *
 * This reads the source rather than running it, so it costs nothing and cannot
 * be bypassed by a code path that no test happens to exercise.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/** Every model behind a tenant policy. */
const TENANT_MODELS = [
  "user", "session", "invitation", "brand", "client", "person", "clientContact",
  "context", "pipelineStage", "relationship", "relationshipStageChange", "activity",
  "category", "vendor", "bookMonth", "transaction", "attachment", "recurringSpend",
  "task", "taskStatusChange", "auditEntry", "notification", "role", "rolePermission",
  "userClientScope", "userContextScope", "reconciliation",
];

/**
 * Files allowed to name the raw client, each with the reason.
 *
 * `lib/db.ts`            defines it
 * `lib/auth.ts`          resolves a tenant before one is known
 * `lib/provisioning.ts`  creates the tenant it then binds to
 * `login/actions.ts`     the same ordering problem, at the form
 * `signup/actions.ts`    pending_signups is not tenant-owned
 * `invite/actions.ts`    accepting runs without a session
 */
const ALLOWED = new Set([
  "lib/db.ts",
  "lib/auth.ts",
  "lib/provisioning.ts",
  "app/login/actions.ts",
  "app/signup/actions.ts",
  "app/invite/actions.ts",
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replace(/\\/g, "/");
}

describe("every query names a tenant", () => {
  test("no file queries a tenant-owned model on the raw client", () => {
    const pattern = new RegExp(`\\bdb\\.(${TENANT_MODELS.join("|")})\\.`, "g");
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(file);
      if (ALLOWED.has(rel)) continue;

      const source = readFileSync(file, "utf8");

      // `const db = tenantDb(...)` is the normal shape in a page or a
      // repository function, and `db` there is already bound.
      if (/\bconst db = tenantDb\(/.test(source)) continue;

      // Only the raw client matters, and it is only raw where it was imported
      // from lib/db rather than shadowed.
      if (!/import \{[^}]*\bdb\b[^}]*\} from "@\/lib\/db"/.test(source)) continue;

      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line}  ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the files that are allowed to are few, and each has a reason", () => {
    // If this list grows, the reason for the new entry belongs in the comment
    // above it. A long list means the rule has stopped meaning anything.
    expect(ALLOWED.size).toBeLessThanOrEqual(8);

    for (const rel of ALLOWED) {
      // Every one of them must still exist, or the exemption is stale.
      expect(() => statSync(join(SRC, rel))).not.toThrow();
    }
  });

  test("the exempt files each set app.tenant_id, or resolve one", () => {
    for (const rel of ALLOWED) {
      if (rel === "lib/db.ts") continue; // it is the thing that sets it

      const source = readFileSync(join(SRC, rel), "utf8");
      const setsTenant = /set_config\('app\.tenant_id'/.test(source);
      const resolvesTenant = /auth_tenants_for_email|tenantDb\(/.test(source);
      const signupFlow = /app\.signup_flow|inSignupFlow/.test(source);

      // One of the three has to be true, or the file is simply unbound.
      expect({ file: rel, bound: setsTenant || resolvesTenant || signupFlow }).toEqual({ file: rel, bound: true });
    }
  });
});

describe("the models list stays honest", () => {
  test("it matches what the schema actually maps to tenant-owned tables", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

    // Every model with a tenantId column is tenant-owned by definition.
    const owned = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+tenantId\s+String/m.test(body!))
      .map(([, name]) => name!.charAt(0).toLowerCase() + name!.slice(1));

    const missing = owned.filter((m) => !TENANT_MODELS.includes(m));

    // A model added to the schema without being added here would not be
    // checked by the test above, which is exactly how the next one slips in.
    expect(missing).toEqual([]);
  });
});
