/**
 * Money is stored as an integer number of paise everywhere (₹1 = 100 paise).
 * Floats are never used for rupee totals — 0.1 + 0.2 problems have no place in
 * a ledger. USDT amounts and conversion rates are floats because they are
 * inputs, not balances; the rupee value they produce is rounded once, here.
 */

export function toPaise(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const clean = typeof input === "number" ? input : Number(String(input).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(clean)) return 0;
  return Math.round(clean * 100);
}

export function toRupees(paise: number): number {
  return paise / 100;
}

/** ₹1,00,000 — Indian grouping, no decimals unless the amount has paise. */
export function formatMoney(paise: number, opts: { decimals?: boolean } = {}): string {
  const rupees = toRupees(paise ?? 0);
  const showDecimals = opts.decimals ?? rupees % 1 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);
}

/** Short form for tight spaces: ₹65k, ₹1.2L, ₹3.4Cr. */
export function formatMoneyShort(paise: number): string {
  const v = toRupees(paise ?? 0);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `₹${Math.round(v / 1e3)}k`;
  return `₹${Math.round(v)}`;
}

/** USDT × rate → paise. The one place this conversion happens. */
export function usdtToPaise(usdt: number, rate: number): number {
  if (!Number.isFinite(usdt) || !Number.isFinite(rate)) return 0;
  return Math.round(usdt * rate * 100);
}

export function formatUsdt(usdt: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(usdt)} USDT`;
}
