"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { PAYMENT_STATUS_TONE, type PaymentStatus } from "@/lib/constants";
import { fmtDate } from "@/lib/dates";
import { formatMoney, formatUsdt } from "@/lib/money";
import { cn } from "@/lib/utils";
import { deleteTransaction } from "@/app/(app)/transactions/actions";
import { TransactionFormDialog, type LedgerOptions } from "./transaction-form";

export type LedgerRow = {
  id: string;
  ref: string;
  type: "INCOME" | "EXPENSE";
  date: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  clientId: string | null;
  clientName: string | null;
  usdt: number | null;
  rate: number | null;
  amount: number;
  status: string;
  notes: string | null;
  fromSalary: boolean;
};

export function TransactionList({
  rows,
  options,
  showFilters = true,
  compact = false,
}: {
  rows: LedgerRow[];
  options: LedgerOptions;
  showFilters?: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [editing, setEditing] = useState<LedgerRow | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && ![r.name, r.categoryName ?? "", r.ref, r.clientName ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
      if (type && r.type !== type) return false;
      if (category && r.categoryId !== category) return false;
      if (status && r.status !== status) return false;
      return true;
    });
  }, [rows, query, type, category, status]);

  function remove(row: LedgerRow) {
    if (!confirm(`Delete ${row.ref} — ${row.name}? This cannot be undone.`)) return;
    start(async () => {
      const res = await deleteTransaction(row.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Deleted");
      setSelected(null);
    });
  }

  return (
    <div>
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, category or TX id"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm shadow-card outline-none placeholder:text-subtle focus:border-brand sm:w-64"
            />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-auto min-w-28">
            <option value="">All types</option>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-auto min-w-36">
            <option value="">All categories</option>
            {[...options.incomeSources, ...options.expenseCategories].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-32">
            <option value="">All status</option>
            <option value="Received">Received</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
          </Select>
          {(query || type || category || status) && (
            <button
              onClick={() => {
                setQuery("");
                setType("");
                setCategory("");
                setStatus("");
              }}
              className="text-[13px] text-muted hover:text-fg"
            >
              Clear
            </button>
          )}
          <span className="ml-auto hidden text-xs text-muted sm:block">
            {filtered.length} of {rows.length}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No transactions" description="Income and expenses you record will show up here." />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Category / source</th>
                  <th className="px-3 py-2.5 font-medium">Name</th>
                  {!compact && <th className="px-3 py-2.5 font-medium">Status</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer hover:bg-surface-2/60">
                    <td className="tabular whitespace-nowrap px-4 py-2.5 text-muted">{fmtDate(r.date, "d MMM")}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={r.type === "INCOME" ? "green" : "grey"}>{r.type === "INCOME" ? "Income" : "Expense"}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{r.categoryName ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 font-medium">{r.name}</td>
                    {!compact && (
                      <td className="px-3 py-2.5">
                        <Badge tone={PAYMENT_STATUS_TONE[r.status as PaymentStatus] ?? "grey"}>{r.status}</Badge>
                      </td>
                    )}
                    <td
                      className={cn(
                        "tabular whitespace-nowrap px-4 py-2.5 text-right font-semibold",
                        r.type === "INCOME" ? "text-[var(--green)]" : "text-fg",
                      )}
                    >
                      {r.type === "INCOME" ? "+" : "−"}
                      {formatMoney(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-border sm:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSelected(r)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {fmtDate(r.date, "d MMM")} · {r.categoryName ?? "—"}
                    </span>
                    <span className="mt-1.5 block">
                      <Badge tone={PAYMENT_STATUS_TONE[r.status as PaymentStatus] ?? "grey"}>{r.status}</Badge>
                    </span>
                  </span>
                  <span className={cn("tabular shrink-0 font-semibold", r.type === "INCOME" ? "text-[var(--green)]" : "text-fg")}>
                    {r.type === "INCOME" ? "+" : "−"}
                    {formatMoney(r.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Detail */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent title={selected.name} description={selected.ref}>
            <div className="space-y-3 text-sm">
              <Row label="Type" value={selected.type === "INCOME" ? "Income" : "Expense"} />
              <Row label={selected.type === "INCOME" ? "Source" : "Category"} value={selected.categoryName ?? "—"} />
              {selected.clientName && <Row label="Client" value={selected.clientName} />}
              <Row label="Date" value={fmtDate(selected.date)} />
              {selected.usdt && selected.rate && (
                <>
                  <Row label="USDT" value={formatUsdt(selected.usdt)} />
                  <Row label="Rate" value={`₹${selected.rate}`} />
                </>
              )}
              <Row
                label="Amount"
                value={
                  <span className={cn("tabular text-base font-semibold", selected.type === "INCOME" ? "text-[var(--green)]" : "text-fg")}>
                    {selected.type === "INCOME" ? "+" : "−"}
                    {formatMoney(selected.amount)}
                  </span>
                }
              />
              <Row
                label="Status"
                value={<Badge tone={PAYMENT_STATUS_TONE[selected.status as PaymentStatus] ?? "grey"}>{selected.status}</Badge>}
              />
              {selected.notes && <Row label="Notes" value={selected.notes} />}
              {selected.fromSalary && (
                <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
                  Created from a salary record. Edit it in Salaries so both stay in step.
                </p>
              )}
            </div>

            {!selected.fromSalary && (
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="danger" loading={pending} onClick={() => remove(selected)}>
                  <Trash2 /> Delete
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                >
                  <Pencil /> Edit
                </Button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>

      {/* Edit */}
      {editing && (
        <TransactionFormDialog
          type={editing.type}
          options={options}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          values={{
            id: editing.id,
            type: editing.type,
            date: editing.date,
            categoryId: editing.categoryId,
            name: editing.name,
            clientId: editing.clientId,
            usdt: editing.usdt,
            rate: editing.rate,
            amount: editing.amount,
            status: editing.status,
            notes: editing.notes,
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
