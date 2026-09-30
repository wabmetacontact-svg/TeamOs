"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { guessMapping, IMPORT_FIELDS, parseCsv, type ImportField } from "@/lib/csv";
import { commitImport, previewImport, type PreviewRow } from "./actions";

type Preview = {
  headers: string[];
  rows: PreviewRow[];
  totals: { income: string; spend: string; count: number };
  truncated: boolean;
};

const REQUIRED: ImportField[] = ["date", "name", "amount"];

const FIELD_LABELS: Record<ImportField, string> = {
  date: "Date",
  name: "Payee / description",
  amount: "Amount",
  currency: "Currency",
  exchangeRate: "Exchange rate",
  direction: "In or out",
  client: "Client",
  category: "Category",
  vendor: "Vendor",
  bookMonth: "Book month",
  paymentMethod: "Method",
  paymentStatus: "Payment status",
  description: "Notes",
  tags: "Tags",
};

export function ImportWizard({
  clients,
  baseCurrency,
  canApprove,
}: {
  clients: { id: string; name: string }[];
  baseCurrency: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [defaultClientId, setDefaultClientId] = useState("");
  const [defaultDirection, setDefaultDirection] = useState<"IN" | "OUT">("OUT");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function readFile(file: File) {
    setError(null);
    setPreview(null);
    setDone(null);

    const text = await file.text();
    const parsed = parseCsv(text, { maxRows: 5 });

    if (parsed.headers.length === 0) {
      setError("That file has no header row.");
      return;
    }

    setCsv(text);
    setFilename(file.name);
    setHeaders(parsed.headers);
    // A guess, shown for correction. Never applied silently — a column guessed
    // wrong on four hundred rows is four hundred wrong rows.
    setMapping(guessMapping(parsed.headers));
  }

  const missing = REQUIRED.filter((f) => !mapping[f]);
  const needsClient = !mapping.client && !defaultClientId;

  const good = preview?.rows.filter((r) => r.ok) ?? [];
  const bad = preview?.rows.filter((r) => !r.ok) ?? [];
  const shown = showAll ? (preview?.rows ?? []) : (preview?.rows ?? []).slice(0, 25);

  if (done) {
    return (
      <Card>
        <CardBody className="grid gap-3 py-8 text-center">
          <CheckCircle2 className="mx-auto size-8 text-emerald-600" />
          <p className="text-sm font-medium">{done}</p>
          <div className="flex justify-center gap-2">
            <Button variant="primary" onClick={() => router.push("/ledger")}>
              Open the ledger
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setCsv("");
                setPreview(null);
                setHeaders([]);
                setFilename("");
              }}
            >
              Import another
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="The file" description="A CSV with a header row. Anything Excel or Sheets exports works." />
        <CardBody className="grid gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void readFile(file);
            }}
          />

          {csv ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <FileSpreadsheet className="size-4 shrink-0 text-subtle" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{filename}</span>
              <Badge tone="grey">{headers.length} columns</Badge>
              <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                Choose another
              </Button>
            </div>
          ) : (
            <Button variant="secondary" className="justify-self-start" onClick={() => fileInput.current?.click()}>
              <Upload />
              Choose a CSV
            </Button>
          )}
        </CardBody>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader
            title="Which column is which"
            description="Guessed from the headers. Check every one — a column read wrong is every row read wrong."
          />
          <CardBody className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <Field
                  key={field}
                  label={FIELD_LABELS[field]}
                  htmlFor={`map-${field}`}
                  required={REQUIRED.includes(field)}
                  hint={field === "bookMonth" ? "Defaults to the month of the date" : undefined}
                >
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      setPreview(null);
                      setMapping({ ...mapping, [field]: e.currentTarget.value || undefined });
                    }}
                    className={REQUIRED.includes(field) && !mapping[field] ? "border-[var(--red)]" : undefined}
                  >
                    <option value="">Not in the file</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <Field
                label="Client for rows that do not name one"
                htmlFor="default-client"
                hint={mapping.client ? "Used only where the client column is blank" : "Required — the file has no client column"}
                required={needsClient}
              >
                <Select
                  id="default-client"
                  value={defaultClientId}
                  onChange={(e) => {
                    setPreview(null);
                    setDefaultClientId(e.currentTarget.value);
                  }}
                >
                  <option value="">None</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Direction for rows that do not say"
                htmlFor="default-direction"
                hint="A negative amount is always treated as money out"
              >
                <Select
                  id="default-direction"
                  value={defaultDirection}
                  onChange={(e) => {
                    setPreview(null);
                    setDefaultDirection(e.currentTarget.value as "IN" | "OUT");
                  }}
                >
                  <option value="OUT">Money out</option>
                  <option value="IN">Money in</option>
                </Select>
              </Field>
            </div>

            <Button
              variant="primary"
              className="justify-self-start"
              loading={pending}
              disabled={missing.length > 0 || needsClient}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await previewImport({
                    csv,
                    mapping: mapping as Record<string, string>,
                    defaultClientId: defaultClientId || undefined,
                    defaultDirection,
                  });
                  if (result.ok && result.data) setPreview(result.data);
                  else if (!result.ok) setError(result.error);
                })
              }
            >
              Check every row
            </Button>

            {missing.length > 0 && (
              <p className="text-xs text-muted">
                Still needed: {missing.map((f) => FIELD_LABELS[f]).join(", ")}.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader
            title="What would be imported"
            description={
              bad.length === 0
                ? `All ${good.length} rows are clean.`
                : `${good.length} clean, ${bad.length} with a problem. Only the clean ones would be written.`
            }
            action={
              <div className="text-right text-sm">
                <p className="text-emerald-600">+{formatMoney(BigInt(preview.totals.income), baseCurrency)}</p>
                <p className="text-[var(--red)]">−{formatMoney(BigInt(preview.totals.spend), baseCurrency)}</p>
              </div>
            }
          />

          <CardBody className="grid gap-3">
            <p className="text-sm text-muted">
              Check those two totals against the bottom of your sheet before importing. If they do not match, something
              is mapped wrong — that is much easier to fix now than afterwards.
            </p>

            {preview.truncated && (
              <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                Only the first 2,000 rows were read. Split the file and import it in parts.
              </p>
            )}

            <div className="scrollbar-thin -mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-3xl text-left text-[13px]">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Line</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Payee</th>
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.line} className={`border-b border-border/60 ${row.ok ? "" : "bg-rose-50/50"}`}>
                      <td className="py-1.5 pr-3 tabular-nums text-subtle">{row.line}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{row.date || "—"}</td>
                      <td className="max-w-48 truncate py-1.5 pr-3">{row.name || "—"}</td>
                      <td className="max-w-32 truncate py-1.5 pr-3">{row.clientName || "—"}</td>
                      <td className="max-w-32 truncate py-1.5 pr-3 text-muted">{row.categoryName || "—"}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${row.direction === "IN" ? "text-emerald-600" : ""}`}>
                        {row.direction === "IN" ? "+" : "−"}
                        {formatMoney(BigInt(row.amountBase), baseCurrency, { compact: true }).replace("−", "")}
                      </td>
                      <td className="py-1.5 text-xs text-[var(--red)]">{row.problems.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bad.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                <span>
                  {bad.length} {bad.length === 1 ? "row" : "rows"} cannot be placed. Download them with the reason beside
                  each, fix them in the sheet, and import that file on its own.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => downloadUnplaceable(bad, filename)}
                >
                  Download {bad.length} unplaceable
                </Button>
              </div>
            )}

            {preview.rows.length > shown.length && (
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll(true)}>
                Show all {preview.rows.length} rows
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button
                variant="primary"
                loading={pending}
                disabled={good.length === 0}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await commitImport({
                      rows: good.map((r) => ({
                        line: r.line,
                        date: r.date,
                        name: r.name,
                        clientId: r.clientId!,
                        categoryId: r.categoryId,
                        vendorId: r.vendorId,
                        direction: r.direction,
                        amount: r.amount,
                        currency: r.currency,
                        exchangeRate: r.exchangeRate,
                        amountBase: r.amountBase,
                        bookMonth: r.bookMonth,
                      })),
                      source: filename || undefined,
                    });

                    if (result.ok) {
                      setDone(result.message ?? "Imported.");
                      router.refresh();
                    } else setError(result.error);
                  })
                }
              >
                Import {good.length} {good.length === 1 ? "row" : "rows"}
                {bad.length > 0 && `, skip ${bad.length}`}
              </Button>

              {!canApprove && (
                <span className="text-xs text-muted">
                  These will arrive as drafts — an import cannot be used to skip the approval queue.
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/**
 * The rows the preview could not place, with the reason on each, as a CSV.
 *
 * The unplaceable-row report the cutover plan asks for. A list on screen is
 * read once and lost; a file goes back to whoever keeps the sheet, gets fixed
 * there, and comes back as its own import — which keeps the fix at the source
 * rather than patched in here where the next export would lose it.
 */
function downloadUnplaceable(rows: PreviewRow[], source: string) {
  const cell = (value: string) => {
    const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };

  const header = ["Line", "Problem", "Date", "Name", "Client", "Category", "Direction", "Amount", "Currency", "Book month"];
  const body = rows.map((r) =>
    [
      String(r.line),
      r.problems.join("; "),
      r.date,
      r.name,
      r.clientName,
      r.categoryName,
      r.direction,
      r.amount,
      r.currency,
      r.bookMonth,
    ]
      .map(cell)
      .join(","),
  );

  const csv = "\ufeff" + [header.join(","), ...body].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `unplaceable-${(source || "import").replace(/\.csv$/i, "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
