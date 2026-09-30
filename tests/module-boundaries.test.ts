/**
 * A source-level guard against the two boundary mistakes neither the type
 * checker nor the build can see.
 *
 * **One.** A `"use server"` module may only export async functions. Anything
 * else — a const, an array, an object — is replaced at build time by a
 * server-action reference, so a client component importing it receives a
 * function-shaped stub instead of the value. `tsc` sees the declared type and
 * is satisfied; `next build` succeeds; the page throws in the browser with
 * `X.map is not a function`.
 *
 * Three of these shipped: BRAND_COLORS, CLIENT_STATUSES and ACTIVITY_TYPES.
 * Only one was ever clicked, which is how the other two were still there when
 * the first was reported.
 *
 * **Two.** A `"use client"` module must not import from a `server-only` one.
 * That failure *is* caught, but only by `next build` and only with a stack
 * trace that names the import chain rather than the mistake. Catching it here
 * costs a second and explains itself.
 *
 * Both are read from the source, so a code path no test exercises is checked
 * exactly as well as one that is.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

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

type File = { path: string; source: string; isServerAction: boolean; isClient: boolean; isServerOnly: boolean };

function everyFile(): File[] {
  return sourceFiles(SRC).map((file) => {
    const source = readFileSync(file, "utf8");
    const head = source.slice(0, 400);
    return {
      path: relative(file),
      source,
      isServerAction: /^\s*["']use server["']/.test(head),
      isClient: /^\s*["']use client["']/.test(head),
      isServerOnly: /^\s*import ["']server-only["']/m.test(head),
    };
  });
}

describe("a server action module exports only functions", () => {
  const files = everyFile();

  test("the suite can see the modules at all", () => {
    // A refactor that moved the directive would otherwise make this pass by
    // finding nothing to check.
    const actions = files.filter((f) => f.isServerAction);
    expect(actions.length).toBeGreaterThan(8);
  });

  test("no `use server` module exports a value", () => {
    const offenders: string[] = [];

    for (const file of files.filter((f) => f.isServerAction)) {
      // `export type` and `export interface` are erased at compile time and
      // never reach the runtime boundary, so they are fine.
      const pattern = /^export (?:const|let|var|class|enum|function(?!\s+\w+\s*\()) +(\w+)/gm;

      for (const match of file.source.matchAll(pattern)) {
        const name = match[1]!;
        const declaration = match[0]!;

        // `export const x = defineAction({...})` and `export async function`
        // are the two legitimate shapes.
        const isAction = new RegExp(`export const ${name} = defineAction\\(`).test(file.source);
        if (isAction) continue;
        if (/^export (async )?function/.test(declaration)) continue;

        const line = file.source.slice(0, match.index).split("\n").length;
        offenders.push(`${file.path}:${line}  export ${name}`);
      }
    }

    // Move it to a module with no directive — see lib/ui-enums.ts — and let
    // the action module import it.
    expect(offenders).toEqual([]);
  });

  test("every exported function in one is async", () => {
    const sync: string[] = [];

    for (const file of files.filter((f) => f.isServerAction)) {
      for (const match of file.source.matchAll(/^export function (\w+)/gm)) {
        const line = file.source.slice(0, match.index).split("\n").length;
        sync.push(`${file.path}:${line}  ${match[1]}`);
      }
    }

    // Next refuses a synchronous export from a server action module at build
    // time; catching it here says why.
    expect(sync).toEqual([]);
  });
});

describe("a client module does not reach into server-only code", () => {
  const files = everyFile();

  /** Resolves a relative import to a path under src, for comparison. */
  function resolve(from: string, specifier: string): string | null {
    if (specifier.startsWith("@/")) return specifier.slice(2);
    if (!specifier.startsWith(".")) return null;

    const parts = from.split("/").slice(0, -1);
    for (const segment of specifier.split("/")) {
      if (segment === ".") continue;
      else if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return parts.join("/");
  }

  test("no `use client` module imports a `server-only` one", () => {
    const serverOnly = new Set(
      files.filter((f) => f.isServerOnly).map((f) => f.path.replace(/\.tsx?$/, "")),
    );
    expect(serverOnly.size).toBeGreaterThan(5);

    const offenders: string[] = [];

    for (const file of files.filter((f) => f.isClient)) {
      for (const match of file.source.matchAll(/^import [^"']*["']([^"']+)["']/gm)) {
        const target = resolve(file.path, match[1]!);
        if (!target) continue;

        // A type-only import is erased and never reaches the bundle.
        if (/^import type\b/.test(match[0]!)) continue;

        if (serverOnly.has(target)) {
          const line = file.source.slice(0, match.index).split("\n").length;
          offenders.push(`${file.path}:${line}  imports ${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the vocabularies both sides need live in modules with no directive", () => {
    // These two exist entirely because of this boundary. If either grows a
    // directive, everything importing it breaks in the browser only.
    for (const path of ["lib/ui-enums.ts", "lib/ledger-enums.ts"]) {
      const file = files.find((f) => f.path === path);
      expect({ path, found: Boolean(file) }).toEqual({ path, found: true });
      expect({ path, clean: !file!.isClient && !file!.isServerAction && !file!.isServerOnly }).toEqual({
        path,
        clean: true,
      });
    }
  });
});
