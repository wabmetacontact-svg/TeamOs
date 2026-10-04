"use client";

import { useState } from "react";
import { DOW, MN, dLabel, inr, inrShort, utc, ymAdd, ymLabel } from "@/lib/format";
import type { EntryW } from "@/lib/types";
import { removeBrand } from "@/app/(app)/actions/clients";
import { toggleEntryStatus } from "@/app/(app)/actions/ledger";
import { Icon } from "../icons";
import { fxLine, openModal } from "../modals";
import { useOps } from "../store";
import { CardGrid, Chip, MonthNav, StatCard } from "../ui";
import { ProfitBreakdown } from "./profit";

type TypeFilter = "all" | "in" | "out" | "pending";

export function ExpensesView() {
  const ops = useOps();
  const { w, m } = ops;
  const [ym, setYm] = useState(m.thisMonth);
  const [type, setType] = useState<TypeFilter>("all");
  const [brand, setBrand] = useState("all");
  const canEdit = m.edits("expenses") && !m.previewing;

  /** Settled entries count in the month they were paid, not the month they were billed. */
  const effective = (e: EntryW) => (e.status === "paid" && e.paidOn ? e.paidOn : e.date);
  const inMonth = (k: string) =>
    w.ledger.filter(
      (e) =>
        effective(e).startsWith(k) &&
        (brand === "all" || (e.clientId && m.C(e.clientId)?.brandId === brand) || (!e.clientId && brand === "overhead")),
    );
  const cur = inMonth(ym);
  const prev = inMonth(ymAdd(ym, -1));
  const sum = (list: EntryW[], t: "in" | "out") => list.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
  const inc = sum(cur, "in");
  const out = sum(cur, "out");
  const net = inc - out;
  const change = (a: number, b: number) =>
    b ? `${a >= b ? "Up" : "Down"} ${Math.abs(Math.round(((a - b) / b) * 100))}% on ${MN[Number(ymAdd(ym, -1).slice(5)) - 1]}` : "No prior month";
  const pendIn = cur.filter((e) => e.type === "in" && e.status === "pending").reduce((a, e) => a + e.amount, 0);
  const pendOut = cur.filter((e) => e.type === "out" && e.status === "pending").reduce((a, e) => a + e.amount, 0);

  const shown = cur.filter((e) => type === "all" || e.type === type || (type === "pending" && e.status === "pending"));
  const byDay = new Map<string, EntryW[]>();
  for (const e of shown) byDay.set(effective(e), [...(byDay.get(effective(e)) ?? []), e]);
  const groups = [...byDay.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <>
      <MonthNav label={ymLabel(ym)} prev={() => setYm(ymAdd(ym, -1))} next={() => setYm(ymAdd(ym, 1))} today={() => setYm(m.thisMonth)}>
        {canEdit && (
          <button
            type="button"
            onClick={() => openModal(ops, "entry", { type: "out", date: ym === m.thisMonth ? m.today : `${ym}-01` })}
            className="fw-s h-9 rounded-lg border-0 bg-accent px-4 text-xs text-white hover:bg-accent-h"
          >
            + Add
          </button>
        )}
      </MonthNav>
      <CardGrid>
        <StatCard label="Income" value={inr(inc)} color="#16A34A" note={change(inc, sum(prev, "in"))} />
        <StatCard label="Expenses" value={inr(out)} color="#DC2626" note={change(out, sum(prev, "out"))} />
        <StatCard
          label="Net"
          value={`${net >= 0 ? "+" : "−"}${inr(Math.abs(net))}`}
          color={net >= 0 ? "#16A34A" : "#DC2626"}
          note={inc ? `${Math.round((net / inc) * 100)}% margin` : "No income yet"}
        />
        <StatCard
          label="Pending"
          value={inr(pendIn + pendOut)}
          color={pendIn + pendOut ? "#D97706" : "#64748B"}
          note={pendIn + pendOut ? `${inrShort(pendIn)} to receive · ${inrShort(pendOut)} to pay` : "All clear"}
        />
      </CardGrid>
      {/* Company profit, so only across every brand: a brand filter would make
          "profit" mean something different from one view to the next. */}
      {brand === "all" && m.overhead && <ProfitBreakdown ym={ym} entries={cur} />}

      <div className="my-3.5 flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["in", "Income"],
            ["out", "Expenses"],
            ["pending", "Pending"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} size="sm" active={type === id} label={label} onClick={() => setType(id)} />
        ))}
        <span className="mx-1 w-px bg-line2" />
        <Chip size="sm" active={brand === "all"} label="All brands" onClick={() => setBrand("all")} />
        {w.brands.map((b) => (
          <Chip
            key={b.id}
            size="sm"
            active={brand === b.id}
            label={b.name}
            onClick={() => setBrand(b.id)}
            onRemove={m.isOwner && !m.previewing ? () => ops.run(removeBrand(b.id)).then((r) => r.ok && brand === b.id && setBrand("all")) : undefined}
            removeTitle="Remove brand"
          />
        ))}
        <Chip size="sm" active={brand === "overhead"} label="Overhead" onClick={() => setBrand("overhead")} />
        {!m.previewing && (
          <button
            type="button"
            onClick={() => ops.setQuick({ kind: "brand", target: "none", field: "brand", form: { name: "", kind: "agency" }, error: "", busy: false })}
            className="fw-s h-[30px] rounded-full border border-dashed border-[#A5A5EA] bg-white px-3 text-[11px] text-accent"
          >
            + Add brand
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((day) => {
          const es = byDay.get(day)!.sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === "in" ? -1 : 1));
          const n = sum(es, "in") - sum(es, "out");
          const d = utc(day);
          return (
            <div key={day} className="overflow-hidden rounded-[10px] border border-line bg-white">
              <div className="flex items-center gap-2 bg-[rgba(100,116,139,.08)] px-4 py-2.5 text-[13px]">
                <strong>
                  {MN[d.getUTCMonth()]} {d.getUTCDate()}
                </strong>
                <span className="text-mute">{DOW[d.getUTCDay()]}</span>
                <span className="flex-1" />
                <strong className="tnum" style={{ color: n >= 0 ? "#16A34A" : "#DC2626" }}>
                  {n >= 0 ? "+" : "−"}
                  {inr(Math.abs(n))}
                </strong>
              </div>
              {es.map((e) => (
                <Row key={e.id} e={e} canEdit={canEdit} />
              ))}
            </div>
          );
        })}
        {!groups.length && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-[rgba(100,116,139,.4)] bg-white px-5 py-8 text-[13px] text-mute">
            <span className="min-w-[200px] flex-1">No entries you can see for {ymLabel(ym)}.</span>
            {canEdit && (
              <button type="button" onClick={() => openModal(ops, "entry", { type: "out" })} className="fw-s h-[34px] rounded-full border-0 bg-ink2 px-4 text-xs text-white">
                + Add the first entry
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Row({ e, canEdit }: { e: EntryW; canEdit: boolean }) {
  const ops = useOps();
  const { m } = ops;
  const isIn = e.type === "in";
  const pend = e.status === "pending";
  const sub = [
    e.category,
    e.clientId ? m.clientName(e.clientId) : "Overhead",
    ...(e.method ? [e.method] : []),
    m.P(e.byId).name,
    ...(e.status === "paid" && e.paidOn ? [`billed ${dLabel(e.date)}, paid ${dLabel(e.paidOn)}`] : []),
  ].join(" · ");
  const fx = fxLine(e);
  return (
    <div className="flex items-center gap-3 border-t border-line3 px-4 py-[13px] text-[13px]">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: isIn ? "#DCFCE7" : "#FEE2E2", ["--icon-stroke" as string]: isIn ? "#16A34A" : "#DC2626" }}
      >
        <Icon name="arrow" size={14} style={{ transform: `rotate(${isIn ? "-90deg" : "90deg"})` }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="fw-s block overflow-hidden text-ellipsis">{e.desc}</span>
        <span className="text-[11px] text-mute">{sub}</span>
        {fx && <span className="mt-0.5 block text-[11px] text-indigo">{fx}</span>}
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="fw-s tnum whitespace-nowrap" style={{ color: isIn ? "#16A34A" : "#DC2626" }}>
          {isIn ? "+" : "−"}
          {inr(e.amount)}
        </span>
        <button
          type="button"
          disabled={!canEdit}
          title={pend ? `Mark as ${isIn ? "received" : "paid"}` : "Mark as pending"}
          onClick={() => ops.run(toggleEntryStatus(e.id))}
          className="fw-s rounded border px-2 py-0.5 text-[10px]"
          style={{ background: pend ? "#FFFBEB" : "#DCFCE7", color: pend ? "#B45309" : "#15803D", borderColor: pend ? "#FCD34D" : "transparent" }}
        >
          {pend ? "Pending" : isIn ? "Received" : "Paid"}
        </button>
      </span>
      {canEdit && (
        <span className="flex gap-1">
          <button
            type="button"
            aria-label="Edit"
            onClick={() => openModal(ops, "editEntry", e as unknown as Record<string, unknown>)}
            className="flex size-[30px] items-center justify-center rounded-md border border-line2 bg-white"
          >
            <Icon name="settings" size={14} />
          </button>
          <button
            type="button"
            aria-label="Delete"
            onClick={() => openModal(ops, "confirmDelete", { id: e.id, desc: e.desc, amount: e.amount })}
            className="size-[30px] rounded-md border border-line2 bg-white text-[15px] leading-none text-mute"
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
