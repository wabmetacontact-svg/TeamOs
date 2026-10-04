"use client";

import { useState } from "react";
import { MN, dLong, inr, ymAdd, ymLabel } from "@/lib/format";
import { openModal } from "../modals";
import { useOps } from "../store";
import { MonthNav } from "../ui";

export function ClientsView() {
  const ops = useOps();
  const { w, m, drawer } = ops;
  const [ym, setYm] = useState(m.thisMonth);
  // By month is the default: the month at the top picks which clients are
  // listed - the ones that joined in it. "All" is there because a client with
  // no start date belongs to no month, and would otherwise be unreachable.
  const [all, setAll] = useState(false);
  const selected = drawer?.type === "client" ? drawer.id : null;

  const rows = m.vis
    .filter((c) => all || (c.sinceDate ?? "").startsWith(ym))
    .map((c) => {
      const f = m.finIds.has(c.id);
      const inc = w.ledger.filter((e) => e.clientId === c.id && e.type === "in");
      const mon = inc
        .filter((e) => e.status === "paid" && (all || e.date.startsWith(ym)))
        .reduce((a, e) => a + e.amount, 0);
      return { c, f, inc, mon };
    })
    // Newest first. A client with no start date has nothing to be ordered by,
    // so it goes to the end rather than pretending to be the oldest or newest.
    .sort((a, b) => {
      const x = a.c.sinceDate ?? "";
      const y = b.c.sinceDate ?? "";
      if (x !== y) return !x ? 1 : !y ? -1 : y.localeCompare(x);
      return a.c.name.localeCompare(b.c.name);
    });

  // Moving the month always means "show me that month", even from All.
  const goMonth = (next: string) => {
    setYm(next);
    setAll(false);
  };
  const toggle = (on: boolean) => ({ background: on ? "#111827" : "#fff", color: on ? "#fff" : "#0F172A" });

  return (
    <>
      <MonthNav
        bordered="edge"
        label={all ? "All clients" : ymLabel(ym)}
        prev={() => goMonth(all ? ym : ymAdd(ym, -1))}
        next={() => goMonth(all ? ym : ymAdd(ym, 1))}
        today={() => goMonth(m.thisMonth)}
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="fw-s flex-1 text-[13px] text-mute2">
          Client management{" "}
          <span className="fw-b text-faint">
            ·{" "}
            {all
              ? `${m.vis.length} ${m.vis.length === 1 ? "client" : "clients"}`
              : `${rows.length} joined in ${ymLabel(ym)} · ${m.vis.length} in all`}
          </span>
        </span>
        <button type="button" onClick={() => setAll(false)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(!all)}>
          By month
        </button>
        <button type="button" onClick={() => setAll(true)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(all)}>
          All
        </button>
        {m.edits("clients") && !m.previewing && (
          <button
            type="button"
            onClick={() => openModal(ops, "client")}
            className="fw-s h-[30px] rounded-lg border-0 bg-accent px-3.5 text-xs text-white hover:bg-accent-h"
          >
            + Add client
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ c, f, inc, mon }) => (
          <button
            key={c.id}
            type="button"
            onClick={() => ops.setDrawer({ type: "client", id: c.id })}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-white px-[18px] py-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-colors hover:border-accent-l"
            style={{ borderColor: selected === c.id ? "#5B5BD6" : "#E5E7EB" }}
          >
            <span className="min-w-0 flex-[1_1_280px]">
              <span className="block text-[15px] leading-[1.35]">
                <span className="fw-s">{c.name}</span>
                <span className="text-mute"> — {c.company || c.name}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-mute">
                <span>Since: {c.sinceDate ? dLong(c.sinceDate) : "—"}</span>
                {f && (
                  <>
                    <span>
                      {inc.length} {inc.length === 1 ? "payment" : "payments"}
                    </span>
                    <span className="fw-s text-accent">{inr(c.retainer ?? 0)}/mo</span>
                  </>
                )}
                <span className="text-ink3">{c.services || "No services set"}</span>
                <span>{m.brandName(c.brandId)}</span>
                {/* Who sold it and who is setting it up - both, because after a
                    handover they are usually two different people. */}
                {c.ownerId && <span>Sales: {m.P(c.ownerId).name}</span>}
                {c.onboarderId && c.onboarderId !== c.ownerId && <span>Onboarder: {m.P(c.onboarderId).name}</span>}
              </span>
            </span>
            <span className="flex flex-col items-end">
              <span className="fw-s tnum text-[17px]" style={{ color: !f ? "#94A3B8" : mon > 0 ? "#16A34A" : "#94A3B8" }}>
                {f ? inr(mon) : "Restricted"}
              </span>
              <span className="text-[11px] text-faint">
                {!f ? "Finance access needed" : all ? "Received, all time" : `Received in ${MN[Number(ym.slice(5)) - 1]}`}
              </span>
            </span>
          </button>
        ))}
        {!rows.length && !all && m.vis.length > 0 && (
          <div className="rounded-xl border border-dashed border-edge3 bg-white px-5 py-8 text-[13px] text-mute">
            No client joined in {ymLabel(ym)}. Use the arrows for another month, or All for the whole list.
          </div>
        )}
        {!rows.length && (all || !m.vis.length) && (
          <div className="rounded-xl border border-dashed border-edge3 bg-white px-5 py-8 text-[13px] text-mute">
            {w.brands.length
              ? "No clients yet, or none you have been granted access to."
              : "No clients yet. Add a brand first — clients belong to one of your companies."}
          </div>
        )}
      </div>
    </>
  );
}
