/**
 * Fixed vocabularies that both a server action and a client form need.
 *
 * They live here because a `"use server"` module may only export async
 * functions. Anything else exported from one — a const, an array — is replaced
 * at build time by a server-action reference, so a client component that
 * imports it receives a function-shaped stub rather than the value.
 *
 * The failure is quiet in exactly the wrong way: `tsc` sees the real type and
 * is happy, `next build` succeeds, and the page throws in the browser with
 * `X.map is not a function`. Three of these shipped that way — BRAND_COLORS,
 * CLIENT_STATUSES and ACTIVITY_TYPES — and only one of them was ever clicked.
 *
 * So the rule is the file, not the discipline: a vocabulary both sides need
 * lives in a module with no directive at the top, and the action module
 * re-exports it for server code that already imports from there.
 *
 * `lib/ledger-enums.ts` exists for the same reason one layer down, where the
 * offending module was `server-only` rather than `"use server"`.
 */

// Brand colours used to live here as six fixed names. They are any colour now
// — see lib/brand-colors.ts, which keeps reading the old names.
export const CLIENT_STATUSES = ["Onboarding", "Active", "Paused", "Archived"] as const;
export const ACTIVITY_TYPES = ["Call", "Meeting", "Message", "Note"] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
