/**
 * The ledger's fixed vocabularies.
 *
 * These live apart from `lib/transactions.ts` because that module is
 * `server-only` — it holds queries — and a `<Select>` on the client needs the
 * same lists to render its options. Importing them from there pulls the whole
 * server module into the browser bundle, which Next refuses at build time.
 *
 * TypeScript cannot see that boundary: `tsc` is happy either way, and only the
 * build fails. So the rule is the file, not the discipline — anything both
 * sides need lives here, and `transactions.ts` re-exports it for server code
 * that already imports from there.
 */

export const DIRECTIONS = ["IN", "OUT"] as const;
export const APPROVAL_STATES = ["Draft", "Submitted", "Approved", "Rejected"] as const;
export const PAYMENT_METHODS = ["Bank", "Card", "UPI", "Crypto", "Cash", "Other"] as const;
export const PAYMENT_STATUSES = ["Paid", "Pending", "Overdue"] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
