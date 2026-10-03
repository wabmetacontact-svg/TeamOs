/**
 * Dates and money, the way every screen writes them.
 *
 * Dates travel as "yyyy-MM-dd" strings and are only ever compared as strings:
 * a calendar date has no time zone, and turning it into a Date at local
 * midnight is how a due date quietly moves by a day for somebody in another
 * zone. The few helpers that need arithmetic build the Date in UTC.
 *
 * Money arrives from the server already converted from paise to rupees.
 */

export const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MNF = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOWL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const p2 = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

/** A calendar date as a Date at UTC midnight, for arithmetic only. */
export function utc(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(s: string, n: number): string {
  const d = utc(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from b to a. */
export const dayDiff = (a: string, b: string) => Math.round((utc(a).getTime() - utc(b).getTime()) / 864e5);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (s: string) => utc(s).getUTCDay();

/** Today in a time zone, as yyyy-MM-dd. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Now in a time zone, as yyyy-MM-ddTHH:mm. */
export function nowIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/** "29 Aug" */
export function dLabel(s: string | null | undefined): string {
  if (!s) return "No date";
  const d = utc(s);
  return `${d.getUTCDate()} ${MN[d.getUTCMonth()]}`;
}

/** "29 Aug 2026" */
export function dLong(s: string | null | undefined): string {
  if (!s) return "—";
  const d = utc(s);
  return `${d.getUTCDate()} ${MN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "29 Aug 2026, 14:05" from yyyy-MM-ddTHH:mm */
export function fmtTs(s: string | null | undefined): string {
  if (!s) return "—";
  return `${dLong(s.slice(0, 10))}, ${s.slice(11, 16)}`;
}

/** "29 Aug, 14:05" */
export function fmtTsShort(s: string | null | undefined): string {
  if (!s) return "";
  return `${dLabel(s.slice(0, 10))}, ${s.slice(11, 16)}`;
}

/** Moves a yyyy-MM key by n months. */
export function ymAdd(k: string, n: number): string {
  let [y, m] = k.split("-").map(Number) as [number, number];
  m += n;
  while (m > 12) {
    m -= 12;
    y++;
  }
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${p2(m)}`;
}

/** "September 2026" */
export function ymLabel(k: string): string {
  const [y, m] = k.split("-").map(Number) as [number, number];
  return `${MNF[m - 1]} ${y}`;
}

/** "Sep 2026" */
export function ymShort(s: string): string {
  return `${MN[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}

export const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const ordinal = (n: number) =>
  n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

// ───────────────────────────────────────────────────────────────── money ───

export const CURRENCIES = ["INR", "USD", "USDT", "USDC"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** ₹1,23,456 — Indian grouping, whole rupees. */
export function inr(n: number): string {
  return (n < 0 ? "−" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
}

/** ₹1.23L or ₹45k, for cards where width matters. */
export function inrShort(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 100000) return `${s}₹${+(a / 100000).toFixed(2)}L`;
  return `${s}₹${Math.round(a / 1000)}k`;
}

/** "1,000 USD" */
export function fmtCur(n: number, cur: string): string {
  return `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}`;
}

/** Reads what somebody typed as a rupee amount: "1,20,000", "₹ 5000". */
export function readAmount(v: string | number | null | undefined): number {
  return Number(String(v ?? "").replace(/[,₹\s]/g, ""));
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const firstName = (name: string) => name.split(" ")[0] ?? name;

/** The first link in a piece of text, if any. */
export const firstLink = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? "";
