/**
 * CSV, parsed properly.
 *
 * `split(",")` is the wrong answer and it breaks on the first row that has a
 * comma inside a quoted field — which, for financial data, is the first row
 * with an amount in it. This is a small state machine instead: it handles
 * quotes, doubled quotes inside quotes, CRLF and LF, and a trailing newline.
 *
 * It is here rather than pulled from a package because the whole thing is
 * forty lines, and a parser whose behaviour has to be exactly understood is
 * better owned than depended on.
 */

export type CsvRow = Record<string, string>;

export function parseCsv(text: string, options: { maxRows?: number } = {}): { headers: string[]; rows: CsvRow[] } {
  const grid = parseGrid(stripBom(text), options.maxRows ? options.maxRows + 1 : undefined);
  if (grid.length === 0) return { headers: [], rows: [] };

  const headers = dedupeHeaders(grid[0]!.map((h) => h.trim()));

  const rows = grid.slice(1).flatMap((cells) => {
    // A row of nothing but separators is what a trailing newline leaves.
    if (cells.every((c) => c.trim() === "")) return [];
    const row: CsvRow = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? "").trim();
    });
    return [row];
  });

  return { headers, rows };
}

function stripBom(text: string): string {
  // Excel writes one, and it turns the first header into "﻿Date".
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Two columns both called "Amount" would silently overwrite each other. */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, i) => {
    const name = header || `Column ${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

function parseGrid(text: string, maxRows?: number): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // CRLF is one line ending, not two.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      grid.push(row);
      row = [];
      field = "";
      if (maxRows && grid.length >= maxRows) return grid;
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    grid.push(row);
  }

  return grid;
}

/**
 * Guesses which column is which, from its header.
 *
 * A guess, offered for correction — never applied silently. The mapping screen
 * shows what it picked and lets every one be changed, because a column guessed
 * wrong on an import of four hundred rows is four hundred wrong rows.
 */
export const IMPORT_FIELDS = [
  "date",
  "name",
  "amount",
  "currency",
  "exchangeRate",
  "direction",
  "client",
  "category",
  "vendor",
  "bookMonth",
  "paymentMethod",
  "paymentStatus",
  "description",
  "tags",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

const HINTS: Record<ImportField, RegExp> = {
  date: /^(date|txn.?date|transaction.?date|paid.?on|when)$/i,
  name: /^(name|payee|vendor.?name|description|particulars|paid.?to|received.?from|narration)$/i,
  amount: /^(amount|value|total|debit|credit|sum|amt)$/i,
  currency: /^(currency|ccy|curr)$/i,
  exchangeRate: /^(rate|fx|exchange.?rate|conversion)$/i,
  direction: /^(direction|type|in.?out|dr.?cr|flow)$/i,
  client: /^(client|customer|account|project)$/i,
  category: /^(category|head|expense.?head|bucket|class)$/i,
  vendor: /^(vendor|supplier|merchant|source)$/i,
  bookMonth: /^(month|book.?month|period|posting.?month)$/i,
  paymentMethod: /^(method|payment.?method|mode|paid.?by)$/i,
  paymentStatus: /^(status|payment.?status|paid\??)$/i,
  description: /^(notes?|remarks?|memo|comment|detail)$/i,
  tags: /^(tags?|labels?)$/i,
};

export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  const taken = new Set<string>();

  // Exact-ish matches first, so "Description" goes to `description` rather than
  // being taken by `name`'s looser pattern.
  for (const field of IMPORT_FIELDS) {
    const match = headers.find((h) => !taken.has(h) && HINTS[field].test(h.replace(/[\s_-]+/g, "")));
    if (match) {
      mapping[field] = match;
      taken.add(match);
    }
  }

  // A second pass for the ones that are commonly spelled out.
  if (!mapping.name) {
    const fallback = headers.find((h) => !taken.has(h) && /name|payee|particular|narration/i.test(h));
    if (fallback) mapping.name = fallback;
  }
  if (!mapping.amount) {
    const fallback = headers.find((h) => !taken.has(h) && /amount|amt|value|total/i.test(h));
    if (fallback) mapping.amount = fallback;
  }

  return mapping;
}

/**
 * Dates as they actually arrive from a spreadsheet: yyyy-mm-dd, dd/mm/yyyy,
 * dd-MMM-yyyy. Returns yyyy-MM-dd, or null.
 *
 * Day-first when it is ambiguous, because these books are Indian and
 * 03/04/2026 means 3 April here. An import that silently reads it as 4 March
 * puts a month of entries in the wrong period.
 */
export function parseImportDate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return pad(iso[1]!, iso[2]!, iso[3]!);

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (slashed) {
    const [, a, b, y] = slashed;
    const year = y!.length === 2 ? `20${y}` : y!;

    // 13/04 can only be day-first. 04/13 can only be month-first. 03/04 is
    // genuinely ambiguous, and these books are Indian, so it is 3 April — an
    // import that read it as 4 March would put a month of entries in the
    // wrong period, and nothing downstream would notice.
    if (Number(a) > 12) return pad(year, b!, a!);
    if (Number(b) > 12) return pad(year, a!, b!);
    return pad(year, b!, a!);
  }

  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2,4})$/.exec(text);
  if (named) {
    const month = MONTHS.findIndex((m) => named[2]!.toLowerCase().startsWith(m));
    if (month >= 0) {
      const year = named[3]!.length === 2 ? `20${named[3]}` : named[3]!;
      return pad(year, String(month + 1), named[1]!);
    }
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${year.padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** IN or OUT, from whatever the sheet calls it. */
export function parseDirection(input: string, fallback: "IN" | "OUT" = "OUT"): "IN" | "OUT" {
  const text = input.trim().toLowerCase();
  if (!text) return fallback;
  if (/^(in|income|credit|cr|received|receipt|revenue|\+)/.test(text)) return "IN";
  if (/^(out|expense|debit|dr|paid|spend|payment|-)/.test(text)) return "OUT";
  return fallback;
}
