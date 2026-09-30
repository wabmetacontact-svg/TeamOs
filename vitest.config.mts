import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The guard is for the bundler, not for Node; see the stub for why.
      "server-only": here("./tests/support/server-only.ts"),
      "@": here("./src"),
    },
  },
  test: {
    // Runs before any test file, so the connection bounds are in place before
    // the first PrismaClient is constructed. See the file for why.
    setupFiles: [here("./tests/support/setup.ts")],
    // These talk to a real Postgres over the wire; the default 5s is too tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One database, shared state — run files in sequence.
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
});
