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
  const selected = drawer?.type === "client" ? drawer.id : null;

  const rows = m.vis
    .map((c) => {
      const f = m.finIds.has(c.id);
      const inc = w.ledger.filter((e) => e.clientId === c.id && e.type === "in");
      const mon = inc.filter((e) => e.status === "paid" && e.date.startsWith(ym)).reduce((a, e) => a + e.amount, 0);
      return { c, f, inc, mon };
    })
    .sort((a, b) => b.mon - a.mon || a.c.name.localeCompare(b.c.name));

  return (
    <>
      <MonthNav bordered="edge" label={ymLabel(ym)} prev={() => setYm(ymAdd(ym, -1))} next={() => setYm(ymAdd(ym, 1))} today={() => setYm(m.thisMonth)} />
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="fw-s flex-1 text-[13px] text-mute2">
          Client management{" "}
          <span className="fw-b text-faint">
            · {m.vis.length} {m.vis.length === 1 ? "client" : "clients"}
          </span>
        </span>
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
              </span>
            </span>
            <span className="flex flex-col items-end">
              <span className="fw-s tnum text-[17px]" style={{ color: !f ? "#94A3B8" : mon > 0 ? "#16A34A" : "#94A3B8" }}>
                {f ? inr(mon) : "Restricted"}
              </span>
              <span className="text-[11px] text-faint">{f ? `Received in ${MN[Number(ym.slice(5)) - 1]}` : "Finance access needed"}</span>
            </span>
          </button>
        ))}
        {!rows.length && (
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
