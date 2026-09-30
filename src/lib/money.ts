/**
 * Money.
 *
 * Every amount in this application is a BigInt of minor units — paise, cents —
 * and a three-letter currency beside it. Never a float. A float cannot hold
 * 0.1 exactly, so a column of them drifts, and the one thing the finance module
 * has to do is reconcile against a sheet somebody else keeps. Off by one paisa
 * across four thousand rows is the same as broken.
 *
 * Two amounts are stored on every transaction:
 *
 *   amountOriginal + currencyOriginal — what actually left the account
 *   amountBase                        — the same sum in the tenant's currency
 *
 * `amountBase` is computed once, at entry, from the rate that applied then, and
 * is never recomputed. Every total is built from it. This is why a rate change
 * today cannot move last month's figures: last month's rows already hold their
 * own answer, and nothing recalculates them.
 */

/** Currencies with no minor unit. Dividing these by 100 invents paise. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF", "PYG", "UGX", "RWF", "VUV", "KMF", "DJF", "GNF"]);

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
}

/**
 * Parses what a person typed into minor units.
 *
 * Accepts the shapes that actually arrive: `1,20,000`, `1 20 000`, `₹1200.50`,
 * `1200.5`, `(500)` for a negative in accounting notation. Returns null when it
 * is not a number, so the caller reports it rather than storing a zero.
 */
export function parseAmount(input: string | number | null | undefined, currency = "INR"): bigint | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? BigInt(Math.round(input * minorUnits(currency))) : null;
  }

  let text = input.trim();
  if (!text) return null;

  // Accounting negatives: (500) means -500.
  const parenthesised = /^\((.*)\)$/.exec(text);
  const negative = Boolean(parenthesised) || text.startsWith("-");
  if (parenthesised) text = parenthesised[1]!;

  // Strip currency symbols, codes, separators and spaces. The decimal point is
  // the only punctuation that survives.
  const cleaned = text.replace(/[₹$€£¥]|[A-Za-z]{3}/g, "").replace(/[,\s'_]/g, "").replace(/^-/, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;

  const [whole = "0", fraction = ""] = cleaned.split(".");
  const scale = minorUnits(currency);
  const digits = String(scale).length - 1;

  // Round rather than truncate, and do it on the string so no float is ever
  // involved: "10.999" at two places is 1100, not 1099.
  const padded = (fraction + "0".repeat(digits + 1)).slice(0, digits + 1);
  const base = BigInt(whole || "0") * BigInt(scale) + BigInt(padded.slice(0, digits) || "0");
  const rounded = Number(padded[digits] ?? "0") >= 5 ? base + 1n : base;

  return negative ? -rounded : rounded;
}

/** Minor units back to the decimal string a form field should hold. */
export function toInput(amount: bigint | null | undefined, currency = "INR"): string {
  if (amount == null) return "";
  const scale = BigInt(minorUnits(currency));
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const digits = String(minorUnits(currency)).length - 1;

  if (digits === 0) return `${negative ? "-" : ""}${abs}`;
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * For display. Indian grouping by default, because these are Indian books and
 * `12,00,000` is what the people reading it expect to see, not `1,200,000`.
 */
export function formatMoney(
  amount: bigint | null | undefined,
  currency = "INR",
  options: { compact?: boolean; sign?: boolean; locale?: string } = {},
): string {
  if (amount == null) return "—";

  const locale = options.locale ?? (currency === "INR" ? "en-IN" : "en-US");
  const scale = minorUnits(currency);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const major = Number(abs) / scale;

  if (options.compact) {
    return `${negative ? "−" : options.sign ? "+" : ""}${currency === "INR" ? "₹" : ""}${compact(major, currency)}`;
  }

  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: scale === 1 ? 0 : 2,
    maximumFractionDigits: scale === 1 ? 0 : 2,
  }).format(major);

  return negative ? `−${formatted}` : options.sign ? `+${formatted}` : formatted;
}

/** 1200000 → 12L. Lakh and crore for INR, K/M elsewhere. */
function compact(major: number, currency: string): string {
  if (currency === "INR") {
    if (major >= 10_000_000) return `${trim(major / 10_000_000)}Cr`;
    if (major >= 100_000) return `${trim(major / 100_000)}L`;
    if (major >= 1_000) return `${trim(major / 1_000)}K`;
  } else {
    if (major >= 1_000_000) return `${trim(major / 1_000_000)}M`;
    if (major >= 1_000) return `${trim(major / 1_000)}K`;
  }
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 }).format(major);
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, "");
}

/**
 * Converts at a captured rate, rounding half-up on integers.
 *
 * The rate is a decimal string rather than a number because it arrives from
 * Postgres `Decimal(18,8)` and a float would lose the tail. Everything here is
 * BigInt arithmetic: the rate is scaled to an integer, multiplied, and divided
 * back with explicit rounding.
 */
export function convert(amount: bigint, rate: string | number, fromCurrency: string, toCurrency: string): bigint {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amount;

  const [whole = "0", fraction = ""] = String(rate).split(".");
  const scaleDigits = Math.min(fraction.length, 8);
  const scale = 10n ** BigInt(scaleDigits);
  const scaledRate = BigInt(whole) * scale + BigInt((fraction.slice(0, scaleDigits) || "0").padEnd(scaleDigits, "0") || "0");

  if (scaledRate === 0n) return 0n;

  // Minor-unit counts differ: ¥100 is 100 minor units, ₹100 is 10000.
  const fromScale = BigInt(minorUnits(fromCurrency));
  const toScale = BigInt(minorUnits(toCurrency));

  const numerator = amount * scaledRate * toScale;
  const denominator = scale * fromScale;

  return divideRoundHalfUp(numerator, denominator);
}

/** Integer division that rounds half away from zero, as accounting expects. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero");

  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;

  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/** Sums a column without ever leaving BigInt. */
export function sum(amounts: (bigint | null | undefined)[]): bigint {
  return amounts.reduce<bigint>((total, amount) => total + (amount ?? 0n), 0n);
}

/** yyyy-MM, the book month a date falls in. */
export function bookMonthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isBookMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "2026-09" → "September 2026". */
export function formatBookMonth(month: string): string {
  if (!isBookMonth(month)) return month;
  const [year, m] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The month before, for period-on-period comparisons. */
export function previousBookMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year! - 1}-12` : `${year}-${String(m! - 1).padStart(2, "0")}`;
}

export function nextBookMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year! + 1}-01` : `${year}-${String(m! + 1).padStart(2, "0")}`;
}
