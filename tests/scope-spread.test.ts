/**
 * A source-level guard against the bug this codebase has written five times.
 *
 * `clientIdScope(scope)` and `contextIdScope(scope)` return `{ id: { in: [...] } }`.
 * Spread into an object literal that also sets `id`, the later key wins:
 *
 *     { ...clientIdScope(scope), id: clientId }   // scope filter gone
 *
 * and the query returns any row in the tenant with that id. It compiles, it
 * type-checks, it lints clean, and every other route to the same data stays
 * correct — which is exactly why it survived review each time.
 *
 * Where it has shipped:
 *
 *   1. clientWhere            — fetching a client by id returned any client
 *   2. pipelineSummary        — a hidden pipeline returned a visible one's numbers
 *   3. rowsBehind             — the rows behind a reconciliation, unscoped
 *
 * and twice more in the relationship and context reads before they were
 * rewritten around AND. Each fix was followed by a comment explaining the bug,
 * and the next one was written anyway. Comments do not stop this; a test does.
 *
 * The rule: never spread an id-scope helper into an object literal that also
 * names `id`. Nest the scope inside `AND`, or go through the module's own
 * get-by-id function.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const HELPERS = ["clientIdScope", "contextIdScope"];

/**
 * Source with comments blanked out. The first run of this guard flagged the
 * comment above the fix for this very bug, because the comment quotes the
 * line that shipped. A guard that trips on its own documentation teaches
 * people to delete the documentation.
 *
 * Replaced with spaces rather than removed, so line numbers in a failure still
 * point at the right place. `//` only counts at line start or after
 * whitespace, so a URL in a string is left alone.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (line, lead) => lead + " ".repeat(line.length - lead.length));
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * The object literal a spread sits in: walk back to the unmatched `{`, then
 * forward to its matching `}`. Crude, and deliberately so — a real parser
 * would be one more thing to keep in step with a test whose job is to be
 * obviously right.
 */
function enclosingLiteral(source: string, at: number): string {
  let depth = 0;
  let start = at;
  for (let i = at; i >= 0; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }

  depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** The literal's own keys, with nested objects blanked out. */
function topLevel(literal: string): string {
  let depth = 0;
  let out = "";
  for (const c of literal) {
    if (c === "{" || c === "[" || c === "(") depth++;
    if (depth <= 1) out += c;
    if (c === "}" || c === "]" || c === ")") depth--;
  }
  return out;
}

describe("id-scope helpers are never spread beside an id", () => {
  test("no literal both spreads a scope helper and sets id", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");

      for (const helper of HELPERS) {
        for (const match of source.matchAll(new RegExp(`\\.\\.\\.${helper}\\(`, "g"))) {
          const keys = topLevel(enclosingLiteral(source, match.index!));

          // An `id:` at the literal's own level is the collision. One inside a
          // nested select — `{ select: { id: true } }` — is not, and topLevel
          // has already blanked those out.
          if (/[{,\s]id\s*:/.test(keys)) {
            const line = source.slice(0, match.index).split("\n").length;
            offenders.push(`${rel}:${line}  ...${helper}(…) beside id`);
          }
        }
      }
    }

    // Nest the scope inside AND — see clientWhere in lib/clients.ts — or call
    // the module's get-by-id function, which already does.
    expect(offenders).toEqual([]);
  });

  test("a comment quoting the bug is not the bug", () => {
    const documented = `// The first version was { ...clientIdScope(scope), id: clientId }
await getClient(scope, id);`;
    expect(withoutComments(documented)).not.toContain("clientIdScope");
  });

  test("the guard would have caught the version that shipped", () => {
    // Proof the check is not vacuous: the exact line from rowsBehind.
    const shipped = `db.client.findFirst({ where: { ...clientIdScope(scope), id: clientId } });`;
    const at = shipped.indexOf("...clientIdScope(");
    expect(/[{,\s]id\s*:/.test(topLevel(enclosingLiteral(shipped, at)))).toBe(true);

    // And that a nested id in a select is not mistaken for one.
    const fine = `db.client.findMany({ where: { ...clientIdScope(scope), deletedAt: null }, select: { id: true } });`;
    const at2 = fine.indexOf("...clientIdScope(");
    expect(/[{,\s]id\s*:/.test(topLevel(enclosingLiteral(fine, at2)))).toBe(false);
  });
});
