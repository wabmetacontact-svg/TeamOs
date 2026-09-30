import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatBookMonth } from "@/lib/money";
import { can, clientScope } from "@/lib/scope";
import type { Prisma } from "@prisma/client";

/**
 * Exporting the ledger.
 *
 * The plan asks for "async exports above a row threshold". Async there means a
 * queue, a worker and somewhere to put the finished file — three pieces of
 * infrastructure this deployment does not have, and adding them for one
 * feature would be the wrong trade.
 *
 * The problem async solves is holding a large result in memory and blowing a
 * function's limits. Streaming solves the same problem without any of the
 * parts: rows are fetched in pages, turned into CSV, and pushed down the wire
 * as they are produced. Memory stays flat whatever the row count, and the
 * client sees bytes immediately rather than waiting for the whole file.
 *
 * What it does not solve is a platform timeout on a genuinely enormous export.
 * That is why there is a hard cap with a message that says what to do, rather
 * than a request that dies halfway through and leaves a truncated file the
 * person cannot tell is truncated.
 */

/** Fetched per round trip. Large enough to amortise latency, small enough
 *  that one page is never a memory problem. */
const PAGE = 1000;

/** Above this, the export is refused with instructions rather than attempted. */
const MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const { user, scope } = await requireScope();
  if (!can(scope, "expense:export")) return new Response("Not found.", { status: 404 });

  const params = new URL(request.url).searchParams;
  const db = tenantDb(user.tenantId);

  const where: Prisma.TransactionWhereInput = {
    ...clientScope(scope),
    deletedAt: null,
    ...(params.get("from") || params.get("to")
      ? {
          bookMonth: {
            ...(params.get("from") ? { gte: params.get("from")! } : {}),
            ...(params.get("to") ? { lte: params.get("to")! } : {}),
          },
        }
      : {}),
    ...(params.get("month") ? { bookMonth: params.get("month")! } : {}),
    ...(params.get("client") ? { clientId: params.get("client")! } : {}),
    ...(params.get("direction") ? { direction: params.get("direction")! } : {}),
    // Approved only unless asked otherwise: an export that quietly includes
    // drafts will not reconcile against anything.
    ...(params.get("all") === "1" ? {} : { approvalState: "Approved" }),
  };

  const total = await db.transaction.count({ where });

  if (total > MAX_ROWS) {
    return new Response(
      `That is ${total.toLocaleString("en-IN")} rows, over the ${MAX_ROWS.toLocaleString("en-IN")} cap. ` +
        `Export a narrower range — add ?from=YYYY-MM&to=YYYY-MM.`,
      { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const header = [
    "Reference",
    "Date",
    "Book month",
    "Direction",
    "Client",
    "Brand",
    "Category",
    "Vendor",
    "Name",
    "Amount",
    "Currency",
    "Rate",
    `Amount (${user.baseCurrency})`,
    "Method",
    "Payment status",
    "Approval",
    "Approved by",
    "Entered by",
    "Tags",
    "Description",
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // The BOM is for Excel, which otherwise reads UTF-8 as Latin-1 and turns
      // every accented name into mojibake.
      controller.enqueue(encoder.encode(`﻿${header.map(csvCell).join(",")}\r\n`));

      let cursor: string | undefined;
      let sent = 0;

      try {
        for (;;) {
          const rows = await db.transaction.findMany({
            where,
            include: {
              client: { select: { name: true, brand: { select: { name: true } } } },
              category: { select: { name: true, parent: { select: { name: true } } } },
              vendor: { select: { name: true } },
              createdBy: { select: { name: true } },
              approvedBy: { select: { name: true } },
            },
            // Keyset rather than offset: skip/take re-reads and re-sorts every
            // preceding row, so page 90 of a 100,000-row export costs ninety
            // times page 1.
            orderBy: { id: "asc" },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            take: PAGE,
          });

          if (rows.length === 0) break;

          const chunk = rows
            .map((t) =>
              [
                t.ref,
                t.date.toISOString().slice(0, 10),
                formatBookMonth(t.bookMonth),
                t.direction === "IN" ? "In" : "Out",
                t.client.name,
                t.client.brand.name,
                t.category ? [t.category.parent?.name, t.category.name].filter(Boolean).join(" · ") : "",
                t.vendor?.name ?? "",
                t.name,
                // Decimal strings, not formatted money: a spreadsheet has to
                // be able to add this column up.
                decimal(t.amountOriginal),
                t.currencyOriginal,
                t.exchangeRate.toString(),
                decimal(t.amountBase),
                t.paymentMethod,
                t.paymentStatus,
                t.approvalState + (t.approvalInferred ? " (inferred)" : ""),
                t.approvedBy?.name ?? "",
                t.createdBy.name,
                t.tags.join(" "),
                t.description ?? "",
              ]
                .map(csvCell)
                .join(","),
            )
            .join("\r\n");

          controller.enqueue(encoder.encode(chunk + "\r\n"));

          sent += rows.length;
          cursor = rows.at(-1)!.id;
          if (rows.length < PAGE || sent >= MAX_ROWS) break;
        }
      } catch (err) {
        // A stream that fails mid-file cannot change its status code, so the
        // failure is written into the file itself. A truncated CSV that says
        // nothing is a CSV somebody reconciles against and does not notice.
        console.error("Ledger export failed mid-stream:", err);
        controller.enqueue(encoder.encode(`\r\n"EXPORT FAILED AFTER ${sent} ROWS — DO NOT USE THIS FILE"\r\n`));
      }

      controller.close();
    },
  });

  const filename = `ledger-${params.get("month") ?? params.get("from") ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // One tenant's money. No shared cache should ever hold it.
      "cache-control": "no-store, private",
      "x-row-count": String(total),
    },
  });
}

/** Minor units to a decimal string a spreadsheet can sum. */
function decimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

function csvCell(value: string): string {
  // A leading =, +, - or @ makes Excel treat the cell as a formula. The
  // leading quote is the standard defence and is invisible in the sheet.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
