/**
 * Bounds what the test suite does to the database, before any client is made.
 *
 * The suite failed once with six errors and took 79 minutes instead of 5. The
 * only difference from a clean run was that `next dev` was running beside it:
 * the dev server holds a Prisma pool open, Neon's free tier caps connections,
 * and between them the suite starved itself. Every failure was a timeout
 * wearing a different hat.
 *
 * That is the worst kind of flakiness — it fails for a reason unrelated to the
 * code, so people stop reading failures and start re-running them. Two URL
 * parameters fix it:
 *
 *   connection_limit  a small pool per client. Files run sequentially
 *                     (fileParallelism is false), so one file never needs
 *                     many, and a low cap leaves room for whatever else is
 *                     connected.
 *
 *   pool_timeout      wait for a connection rather than failing instantly. A
 *                     busy moment should slow a test down, not fail it.
 *
 * Applied here rather than in `.env`, so the application's own pooling is
 * untouched.
 */
import { config } from "dotenv";

// Prisma reads .env when a client is constructed, which is after this file
// runs. Loading it here is what makes the variables exist in time to be
// rewritten — the first version of this assigned `undefined` over them and
// turned both URLs into the literal string "undefined".
config();

function bound(url: string | undefined, limit: number): string | undefined {
  if (!url) return undefined;
  if (url.includes("connection_limit=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=${limit}&pool_timeout=30`;
}

// Assigned only when there is something to assign. `process.env.X = undefined`
// stores the four characters "undefined", which Prisma then reports as a URL
// that does not begin with postgresql:// — a confusing way to learn that an
// environment variable was missing.
const app = bound(process.env.DATABASE_URL, 5);
if (app) process.env.DATABASE_URL = app;

// The owner role does the bulk inserts — the 10,000-row export fixture — so it
// gets a little more room.
const owner = bound(process.env.DIRECT_URL, 8);
if (owner) process.env.DIRECT_URL = owner;

if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  // Better than twenty-two files each failing with their own confusing error.
  throw new Error("DATABASE_URL and DIRECT_URL must be set. Is .env present?");
}
