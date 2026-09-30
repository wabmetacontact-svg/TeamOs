import { requireScope } from "@/lib/auth";
import { exportClients } from "@/lib/clients";
import { formatFieldValue, readCustomFields, readFieldDefs } from "@/lib/custom-fields";
import { can } from "@/lib/scope";

/**
 * The export route.
 *
 * This is the one the stage 1 gate is really aimed at, because an export is
 * where scope quietly goes missing: it runs in the background, nobody reads its
 * output row by row, and a `findMany` without a filter looks identical to one
 * with. It gets no query of its own — `exportClients` is the same function the
 * list page calls, with the same Scope, so a client outside scope cannot appear
 * here any more than it can appear on screen.
 */
export async function GET(request: Request) {
  const { user, scope } = await requireScope();

  // A route handler is not covered by defineAction, so the check is explicit.
  // The catalogue has no client:export key — clients carry no figures, so the
  // same permission that opens the list opens the file. The moment a money
  // column appears here, this becomes expense:export.
  if (!can(scope, "client:view")) return new Response("Not found.", { status: 404 });

  const params = new URL(request.url).searchParams;
  const clients = await exportClients(scope, {
    q: params.get("q") ?? undefined,
    brandId: params.get("brand") ?? undefined,
    status: params.get("status") ?? undefined,
    includeArchived: params.get("archived") === "1",
  });

  // Custom fields differ per brand, so the columns are the union of every
  // definition in the result — a client simply has nothing under another
  // brand's column.
  const customColumns = new Map<string, { brand: string; def: ReturnType<typeof readFieldDefs>[number] }>();
  for (const client of clients) {
    for (const def of readFieldDefs(client.brand.fieldDefs)) {
      customColumns.set(`${client.brand.name}:${def.key}`, { brand: client.brand.name, def });
    }
  }

  const header = [
    "Brand",
    "Client",
    "Legal name",
    "Sub-tag",
    "Status",
    "Billing currency",
    "Start date",
    "Notes",
    ...[...customColumns.values()].map((c) => `${c.brand} — ${c.def.label}`),
  ];

  const rows = clients.map((client) => {
    const defs = readFieldDefs(client.brand.fieldDefs);
    const values = readCustomFields(defs, client.customFields);
    return [
      client.brand.name,
      client.name,
      client.legalName ?? "",
      client.subTag ?? "",
      client.status,
      client.billingCurrency,
      client.startDate ? client.startDate.toISOString().slice(0, 10) : "",
      client.notes ?? "",
      ...[...customColumns.entries()].map(([key, { def }]) =>
        key.startsWith(`${client.brand.name}:`) ? formatFieldValue(def, values[def.key] ?? null) : "",
      ),
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `clients-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(`﻿${csv}`, {
    headers: {
      // The BOM above is for Excel, which otherwise reads UTF-8 as Latin-1 and
      // turns every name with an accent into mojibake.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Contains one tenant's data; no shared cache should ever hold it.
      "cache-control": "no-store, private",
      "x-scope": scope.allClients ? "all" : `${scope.clientIds.length}`,
      "x-tenant": user.tenantId,
    },
  });
}

function csvCell(value: string): string {
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Prefixing a
  // single quote is the standard defence, and it is invisible in the sheet.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
