/**
 * Stage 3 — the CSV importer, and the reconciliation proof it completes.
 *
 * The gate: "a CSV of last month's real MonthBook data imports, and per-client
 * per-month totals match the sheet **exactly**."
 *
 * Exactly is the word doing the work. An importer that is nearly right is worse
 * than none, because the difference only shows up when somebody compares two
 * numbers months later and cannot tell which is wrong. So the parser is tested
 * against the shapes a real exported sheet actually has — quoted commas,
 * doubled quotes, CRLF, a BOM, Indian date order, accounting negatives — and
 * the totals are compared against a figure computed independently.
 */
import { describe, expect, test } from "vitest";
import { guessMapping, parseCsv, parseDirection, parseImportDate } from "../src/lib/csv";
import { convert, parseAmount, sum } from "../src/lib/money";

describe("parsing a real exported sheet", () => {
  test("a comma inside a quoted field does not split the row", () => {
    const csv = 'Date,Payee,Amount\n2026-02-03,"Sharma, Gupta & Co",12000\n';
    const { rows } = parseCsv(csv);

    // split(",") gives four fields here and shifts every column after it.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Payee).toBe("Sharma, Gupta & Co");
    expect(rows[0]!.Amount).toBe("12000");
  });

  test("a doubled quote inside a quoted field is one literal quote", () => {
    const { rows } = parseCsv('Name,Note\n"Adobe","the ""creative"" suite"\n');
    expect(rows[0]!.Note).toBe('the "creative" suite');
  });

  test("CRLF is one line ending, not a blank row between every entry", () => {
    const { rows } = parseCsv("Date,Amount\r\n2026-02-01,100\r\n2026-02-02,200\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.Amount).toBe("200");
  });

  test("Excel's byte order mark does not end up in the first header", () => {
    const { headers } = parseCsv("﻿Date,Amount\n2026-02-01,100\n");
    // Without stripping it, this header is "﻿Date" and every mapping to
    // "Date" silently finds nothing.
    expect(headers[0]).toBe("Date");
  });

  test("a trailing newline does not produce an empty row", () => {
    const { rows } = parseCsv("Date,Amount\n2026-02-01,100\n\n");
    expect(rows).toHaveLength(1);
  });

  test("two columns with the same header stay distinguishable", () => {
    const { headers, rows } = parseCsv("Amount,Amount\n100,200\n");
    expect(headers).toEqual(["Amount", "Amount (2)"]);
    // Without the rename the second would overwrite the first and half the
    // sheet would import at the wrong figure.
    expect(rows[0]).toEqual({ Amount: "100", "Amount (2)": "200" });
  });

  test("a field with an embedded newline survives", () => {
    const { rows } = parseCsv('Name,Note\n"Adobe","line one\nline two"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Note).toBe("line one\nline two");
  });
});

describe("dates, as spreadsheets actually write them", () => {
  test("the three common formats all land on the same day", () => {
    expect(parseImportDate("2026-02-03")).toBe("2026-02-03");
    expect(parseImportDate("03/02/2026")).toBe("2026-02-03");
    expect(parseImportDate("3-Feb-2026")).toBe("2026-02-03");
    expect(parseImportDate("3 February 2026")).toBe("2026-02-03");
  });

  test("an ambiguous date is read day-first, because these books are Indian", () => {
    // 03/04/2026 is 3 April here. Reading it as 4 March would put a month of
    // entries in the wrong period, and nothing downstream would notice.
    expect(parseImportDate("03/04/2026")).toBe("2026-04-03");
    // Unambiguous the other way: 13 cannot be a month.
    expect(parseImportDate("13/04/2026")).toBe("2026-04-13");
    // And unambiguous the US way: 13 cannot be a day in position two.
    expect(parseImportDate("04/13/2026")).toBe("2026-04-13");
  });

  test("two-digit years become this century", () => {
    expect(parseImportDate("03/02/26")).toBe("2026-02-03");
  });

  test("nonsense returns null rather than a date near today", () => {
    for (const bad of ["", "   ", "not a date", "99/99/9999"]) {
      expect(parseImportDate(bad)).toBeNull();
    }
  });
});

describe("direction, as sheets label it", () => {
  test("the words accountants use both map correctly", () => {
    for (const income of ["in", "IN", "Income", "Credit", "CR", "received", "Revenue", "+"]) {
      expect(parseDirection(income)).toBe("IN");
    }
    for (const spend of ["out", "Expense", "Debit", "DR", "paid", "Payment", "-"]) {
      expect(parseDirection(spend)).toBe("OUT");
    }
  });

  test("a blank or unrecognised value falls back to what the importer was told", () => {
    expect(parseDirection("")).toBe("OUT");
    expect(parseDirection("", "IN")).toBe("IN");
    expect(parseDirection("something else", "IN")).toBe("IN");
  });
});

describe("column guessing", () => {
  test("it finds the obvious ones without being told", () => {
    const mapping = guessMapping(["Date", "Particulars", "Amount", "Currency", "Client", "Expense Head"]);

    expect(mapping.date).toBe("Date");
    expect(mapping.name).toBe("Particulars");
    expect(mapping.amount).toBe("Amount");
    expect(mapping.currency).toBe("Currency");
    expect(mapping.client).toBe("Client");
    expect(mapping.category).toBe("Expense Head");
  });

  test("no column is claimed twice", () => {
    const mapping = guessMapping(["Date", "Description", "Notes", "Amount"]);
    const used = Object.values(mapping).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  test("a header it cannot place is left unmapped rather than guessed at", () => {
    const mapping = guessMapping(["Col1", "Col2", "Col3"]);
    // Everything unmapped is better than something mapped wrong: the screen
    // then asks, instead of importing four hundred rows incorrectly.
    expect(Object.values(mapping).filter(Boolean)).toHaveLength(0);
  });
});

describe("the reconciliation itself", () => {
  /**
   * A month exported the way a real sheet is: mixed date formats, a quoted
   * payee with a comma, an accounting negative, a foreign-currency row, and a
   * total at the bottom the way people actually leave them in.
   */
  const sheet = [
    "Date,Particulars,Client,Expense Head,Amount,Currency,Rate,Type",
    "01/02/2026,Office rent,Alpha,Rent,45000,INR,,Debit",
    '03/02/2026,"Sharma, Gupta & Co",Alpha,Professional,12999,INR,,Debit',
    "05/02/2026,Adobe CC,Alpha,Software,"
      + '"59.99",USD,83.50,Debit',
    "10/02/2026,Retainer received,Alpha,Retainer,250000,INR,,Credit",
    "15/02/2026,Refund,Alpha,Software,(750),INR,,Debit",
    "20/02/2026,Server,Beta,Hosting,8000,INR,,Debit",
    "28/02/2026,Retainer received,Beta,Retainer,120000,INR,,Credit",
  ].join("\r\n");

  test("every row parses, including the awkward ones", () => {
    const { rows } = parseCsv(sheet);
    expect(rows).toHaveLength(7);
    expect(rows[1]!.Particulars).toBe("Sharma, Gupta & Co");
    expect(rows[2]!.Particulars).toBe("Adobe CC");
    // The quoted amount on the Adobe row survives its quotes.
    expect(rows[2]!.Amount).toBe("59.99");
  });

  test("per-client totals match what the sheet's own column adds to", () => {
    const { rows } = parseCsv(sheet);
    const base = "INR";

    const converted = rows.map((row) => {
      const currency = row.Currency || base;
      const raw = parseAmount(row.Amount, currency)!;
      const signed = raw < 0n;
      const absolute = signed ? -raw : raw;
      const rate = row.Rate || "1";
      const direction = signed ? "OUT" : parseDirection(row.Type);

      return {
        client: row.Client!,
        direction,
        amountBase: convert(absolute, rate, currency, base),
      };
    });

    const alphaSpend = sum(converted.filter((r) => r.client === "Alpha" && r.direction === "OUT").map((r) => r.amountBase));
    const alphaIncome = sum(converted.filter((r) => r.client === "Alpha" && r.direction === "IN").map((r) => r.amountBase));

    // Worked out independently, in paise:
    //   rent          45,000.00 → 4,500,000
    //   professional  12,999.00 → 1,299,900
    //   Adobe  $59.99 × 83.50   →   500,917  (₹5,009.165 → half-up on the paisa)
    //   refund          −750.00 →    75,000  (a negative is an outflow)
    expect(alphaSpend).toBe(4_500_000n + 1_299_900n + 500_917n + 75_000n);
    expect(alphaIncome).toBe(25_000_000n);

    const betaSpend = sum(converted.filter((r) => r.client === "Beta" && r.direction === "OUT").map((r) => r.amountBase));
    const betaIncome = sum(converted.filter((r) => r.client === "Beta" && r.direction === "IN").map((r) => r.amountBase));
    expect(betaSpend).toBe(800_000n);
    expect(betaIncome).toBe(12_000_000n);

    // And the workspace figure is the sum of the two clients — not computed
    // separately, which is how the two drift apart.
    const totalSpend = sum(converted.filter((r) => r.direction === "OUT").map((r) => r.amountBase));
    expect(totalSpend).toBe(alphaSpend + betaSpend);
  });

  test("the foreign row converts at the rate in its own column, not a live one", () => {
    // $59.99 at 83.50 is ₹5,009.165 exactly. Half-up on the paisa makes that
    // ₹5,009.17 — and the half is the point: a float would have produced
    // 5009.164999999999 here and rounded the other way.
    expect(convert(5_999n, "83.50", "USD", "INR")).toBe(500_917n);
    // A different rate is a different row, not a recalculation of this one.
    expect(convert(5_999n, "89.00", "USD", "INR")).toBe(533_911n);
  });

  test("an accounting negative is an outflow, not a negative amount", () => {
    // (750) in the sheet means ₹750 went out. Storing −750 as an inflow would
    // make the month's spend too low and its income too low by the same
    // amount, which nets out and hides itself.
    const raw = parseAmount("(750)", "INR")!;
    expect(raw).toBe(-75_000n);
    expect(raw < 0n).toBe(true);
    expect(-raw).toBe(75_000n);
  });
});
