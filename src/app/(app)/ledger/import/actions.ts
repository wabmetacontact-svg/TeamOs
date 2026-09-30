"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { parseCsv, parseDirection, parseImportDate, type ImportField } from "@/lib/csv";
import { bookMonthOf, convert, isBookMonth, parseAmount } from "@/lib/money";
import { isMonthClosed, nextRef } from "@/lib/transactions";
import { can } from "@/lib/scope";

/**
 * Importing a sheet.
 *
 * The reconciliation half of the stage 3 gate: a CSV of a real month goes in,
 * and the per-client per-month totals come out matching the sheet exactly.
 * Getting that right is mostly about refusing to guess.
 *
 * So: every row is validated before any row is written, the whole import is one
 * transaction, and a file with a single unresolvable row imports nothing unless
 * the person says to skip it. A half-imported month is worse than a failed
 * import, because the failure is visible and the half is not.
 *
 * Clients, categories and vendors are matched by name, case-insensitively. An
 * unmatched name is reported rather than created — a typo in a sheet should not
 * quietly produce a fourteenth client called "Alpha Industies".
 */

const MAX_ROWS = 2000;

const mappingSchema = z.record(z.string(), z.string().optional());

export type PreviewRow = {
  line: number;
  ok: boolean;
  problems: string[];
  date: string;
  name: string;
  clientName: string;
  clientId: string | null;
  categoryName: string;
  categoryId: string | null;
  vendorName: string;
  vendorId: string | null;
  direction: "IN" | "OUT";
  amount: string;
  currency: string;
  exchangeRate: string;
  amountBase: string;
  bookMonth: string;
  closed: boolean;
};

/**
 * Parses and checks a file without writing anything. Returns every row with
 * whatever is wrong with it, so the whole file can be corrected in one pass
 * rather than one error at a time.
 */
export const previewImport = defineAction({
  permission: "expense:create",
  input: z.object({
    csv: z.string().min(1, "The file is empty").max(4_000_000),
    mapping: mappingSchema,
    defaultClientId: z.string().optional(),
    defaultDirection: z.enum(["IN", "OUT"]).default("OUT"),
  }),
  async handler(ctx, input) {
    const { headers, rows } = parseCsv(input.csv, { maxRows: MAX_ROWS });
    if (rows.length === 0) throw new UserError("No rows found under the header.", "invalid");

    const [clients, categories, vendors] = await Promise.all([
      ctx.db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      ctx.db.category.findMany({ where: { archived: false }, select: { id: true, name: true, direction: true } }),
      ctx.db.vendor.findMany({ where: { archived: false }, select: { id: true, name: true } }),
    ]);

    const byName = <T extends { id: string; name: string }>(list: T[]) =>
      new Map(list.map((item) => [item.name.trim().toLowerCase(), item]));
    const clientMap = byName(clients);
    const vendorMap = byName(vendors);
    const categoryMap = new Map(categories.map((c) => [`${c.direction}:${c.name.trim().toLowerCase()}`, c]));

    const get = (row: Record<string, string>, field: ImportField) => {
      const column = input.mapping[field];
      return column ? (row[column] ?? "").trim() : "";
    };

    // Which client-months are closed, asked once rather than per row.
    const closedCache = new Map<string, boolean>();
    const checkClosed = async (clientId: string, month: string) => {
      const key = `${clientId}:${month}`;
      if (!closedCache.has(key)) closedCache.set(key, await isMonthClosed(ctx.scope, clientId, month));
      return closedCache.get(key)!;
    };

    const preview: PreviewRow[] = [];

    for (const [index, row] of rows.entries()) {
      const problems: string[] = [];

      const rawDate = get(row, "date");
      const date = parseImportDate(rawDate);
      if (!date) problems.push(rawDate ? `Date "${rawDate}" not understood` : "No date");

      const name = get(row, "name");
      if (!name) problems.push("No payee or description");

      const currency = (get(row, "currency") || ctx.user.baseCurrency).toUpperCase().slice(0, 3);
      const rawAmount = get(row, "amount");
      const amount = parseAmount(rawAmount, currency);
      if (amount == null) problems.push(rawAmount ? `Amount "${rawAmount}" not understood` : "No amount");
      else if (amount === 0n) problems.push("Amount is zero");

      // A negative in the sheet is a direction, not a negative amount.
      const signed = amount != null && amount < 0n;
      const direction = signed ? "OUT" : parseDirection(get(row, "direction"), input.defaultDirection);
      const absolute = amount == null ? null : amount < 0n ? -amount : amount;

      const clientName = get(row, "client");
      const client = clientName ? clientMap.get(clientName.toLowerCase()) : null;
      const clientId = client?.id ?? input.defaultClientId ?? null;
      if (!clientId) problems.push(clientName ? `No client called "${clientName}"` : "No client");
      else if (clientName && !client) problems.push(`No client called "${clientName}"`);

      const categoryName = get(row, "category");
      const category = categoryName ? categoryMap.get(`${direction}:${categoryName.toLowerCase()}`) : null;
      if (categoryName && !category) problems.push(`No ${direction === "IN" ? "income" : "spend"} category called "${categoryName}"`);

      const vendorName = get(row, "vendor");
      const vendor = vendorName ? vendorMap.get(vendorName.toLowerCase()) : null;
      if (vendorName && !vendor) problems.push(`No vendor called "${vendorName}"`);

      const rawMonth = get(row, "bookMonth");
      const bookMonth = rawMonth && isBookMonth(rawMonth) ? rawMonth : date ? bookMonthOf(new Date(`${date}T00:00:00Z`)) : "";
      if (rawMonth && !isBookMonth(rawMonth)) problems.push(`Book month "${rawMonth}" is not yyyy-MM`);

      const rate = get(row, "exchangeRate") || (currency === ctx.user.baseCurrency ? "1" : "");
      if (currency !== ctx.user.baseCurrency && !(Number(rate) > 0)) {
        problems.push(`No ${currency}→${ctx.user.baseCurrency} rate`);
      }

      const closed = clientId && bookMonth ? await checkClosed(clientId, bookMonth) : false;
      if (closed) problems.push(`${bookMonth} is closed for that client`);

      const amountBase =
        absolute != null && Number(rate) > 0 ? convert(absolute, rate, currency, ctx.user.baseCurrency) : 0n;

      preview.push({
        line: index + 2, // +1 for the header, +1 because people count from one
        ok: problems.length === 0,
        problems,
        date: date ?? rawDate,
        name,
        clientName: client?.name ?? clientName,
        clientId,
        categoryName: category?.name ?? categoryName,
        categoryId: category?.id ?? null,
        vendorName: vendor?.name ?? vendorName,
        vendorId: vendor?.id ?? null,
        direction,
        amount: absolute?.toString() ?? "0",
        currency,
        exchangeRate: rate,
        amountBase: amountBase.toString(),
        bookMonth,
        closed,
      });
    }

    const good = preview.filter((r) => r.ok);
    const totals = good.reduce(
      (acc, row) => {
        if (row.direction === "IN") acc.income += BigInt(row.amountBase);
        else acc.spend += BigInt(row.amountBase);
        return acc;
      },
      { income: 0n, spend: 0n },
    );

    return {
      ok: true,
      data: {
        headers,
        rows: preview,
        // Shown before the import runs, so it can be checked against the
        // bottom of the sheet before anything is written.
        totals: { income: totals.income.toString(), spend: totals.spend.toString(), count: good.length },
        truncated: rows.length >= MAX_ROWS,
      },
    } satisfies ActionResult<{
      headers: string[];
      rows: PreviewRow[];
      totals: { income: string; spend: string; count: number };
      truncated: boolean;
    }>;
  },
});

/**
 * Writes the rows the preview accepted, in one transaction. Anything the
 * preview flagged is skipped, and the caller has already seen what.
 */
export const commitImport = defineAction({
  permission: "expense:create",
  input: z.object({
    rows: z
      .array(
        z.object({
          line: z.number().int(),
          date: z.string(),
          name: z.string().min(1),
          clientId: z.string().min(1),
          categoryId: z.string().nullable(),
          vendorId: z.string().nullable(),
          direction: z.enum(["IN", "OUT"]),
          amount: z.string(),
          currency: z.string().length(3),
          exchangeRate: z.string(),
          amountBase: z.string(),
          bookMonth: z.string(),
          description: z.string().optional(),
        }),
      )
      .min(1, "Nothing to import")
      .max(MAX_ROWS),
    source: z.string().trim().max(120).optional(),
  }),
  async handler(ctx, input) {
    // Approved on import when the importer could approve anyway; otherwise
    // Draft, so a Member cannot use an import to skip the queue.
    const selfApproves = can(ctx.scope, "expense:approve");
    const now = new Date();

    // Re-checked here rather than trusted from the preview, which may be
    // minutes old and was computed on the client's copy of the data.
    const clientIds = [...new Set(input.rows.map((r) => r.clientId))];
    const clients = await ctx.db.client.findMany({
      where: { id: { in: clientIds }, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(clients.map((c) => c.id));
    const stray = clientIds.filter((id) => !known.has(id));
    if (stray.length) throw new UserError("A client in this file no longer exists. Re-run the preview.", "conflict");

    for (const row of input.rows) {
      if (await isMonthClosed(ctx.scope, row.clientId, row.bookMonth)) {
        throw new UserError(
          `Line ${row.line}: ${row.bookMonth} was closed since the preview ran. Nothing has been imported.`,
        );
      }
    }

    // One transaction: a half-imported month is worse than a failed import,
    // because the failure is visible and the half is not.
    const created = await ctx.db.$transaction(
      async (tx) => {
        const refs = new Map<string, number>();
        const rows = [];

        for (const row of input.rows) {
          const date = new Date(`${row.date}T00:00:00Z`);
          const stamp = row.date.replace(/-/g, "");

          // Refs are sequential per day, so they are allocated here rather
          // than with a query per row.
          if (!refs.has(stamp)) {
            const seed = await nextRef(ctx.scope, date);
            refs.set(stamp, Number(seed.slice(-3)));
          }
          const n = refs.get(stamp)!;
          refs.set(stamp, n + 1);

          rows.push({
            tenantId: ctx.user.tenantId,
            ref: `TX-${stamp}-${String(n).padStart(3, "0")}`,
            direction: row.direction,
            clientId: row.clientId,
            bookMonth: row.bookMonth,
            date,
            categoryId: row.categoryId,
            vendorId: row.vendorId,
            name: row.name,
            amountOriginal: BigInt(row.amount),
            currencyOriginal: row.currency,
            exchangeRate: row.exchangeRate,
            amountBase: BigInt(row.amountBase),
            description: row.description || null,
            tags: input.source ? [`import:${input.source}`] : ["import"],
            approvalState: selfApproves ? "Approved" : "Draft",
            submittedAt: selfApproves ? now : null,
            approvedById: selfApproves ? ctx.user.id : null,
            approvedAt: selfApproves ? now : null,
            // The PRD's word for a row that was never really approved by a
            // person: it came in already settled, from a sheet.
            approvalInferred: selfApproves,
            createdById: ctx.user.id,
          });
        }

        await tx.transaction.createMany({ data: rows });
        return rows.length;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    const totals = input.rows.reduce(
      (acc, row) => {
        if (row.direction === "IN") acc.income += BigInt(row.amountBase);
        else acc.spend += BigInt(row.amountBase);
        return acc;
      },
      { income: 0n, spend: 0n },
    );

    await ctx.audit({
      action: "imported",
      resourceType: "Transaction",
      resourceId: `import:${now.toISOString()}`,
      resourceLabel: input.source ?? "CSV import",
      after: {
        rows: created,
        income: totals.income.toString(),
        spend: totals.spend.toString(),
        months: [...new Set(input.rows.map((r) => r.bookMonth))],
        approvedOnEntry: selfApproves,
      },
    });

    revalidatePath("/ledger");
    return {
      ok: true,
      data: { count: created },
      message: selfApproves
        ? `${created} ${created === 1 ? "row" : "rows"} imported and counted.`
        : `${created} ${created === 1 ? "row" : "rows"} imported as drafts, waiting to be submitted.`,
    } satisfies ActionResult<{ count: number }>;
  },
});
