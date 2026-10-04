"use client";

import { commissionsFor } from "@/lib/commission";
import { inr, ymLabel } from "@/lib/format";
import { profitFor } from "@/lib/profit";
import type { EntryW } from "@/lib/types";
import { useOps } from "../store";

const money = (paise: number) => `${paise < 0 ? "−" : ""}${inr(Math.abs(paise) / 100)}`;

/**
 * The month's profit, opened up: what came in, each kind of cost, and what is
 * still owed to the team. Before anything owed it is exactly the Net above -
 * the caller passes the same entries the Net card adds up.
 */
export function ProfitBreakdown({ ym, entries }: { ym: string; entries: EntryW[] }) {
  const { w, m } = useOps();

  // ── what has not reached the ledger yet. Needs Payroll; unknown otherwise.
  let owedSalaryPaise: number | null = null;
  let owedCommissionPaise: number | null = null;
  if (m.payV) {
    // The same people the Payroll tab lists for the month, with no salary
    // entry at all yet - a pending entry is already in the Net.
    const lastDay = `${ym}-31`;
    owedSalaryPaise = m.team
      .filter((p) => p.onPayroll && p.salary != null && (!p.start || p.start <= lastDay) && p.status !== "Exited")
      .filter((p) => !w.ledger.some((x) => x.category === "Salaries" && x.memberId === p.id && x.date.startsWith(ym)))
      .reduce((a, p) => a + Math.round((p.salary ?? 0) * 100), 0);

    const earned = commissionsFor({
      ym,
      clients: w.clients.map((c) => ({ id: c.id, ownerId: c.ownerId })),
      entries: w.ledger.map((e) => ({ type: e.type, status: e.status, clientId: e.clientId, date: e.date, category: e.category, amountPaise: Math.round(e.amount * 100) })),
      rates: w.commissionRates.map((r) => ({ memberId: r.memberId, from: r.from, bps: r.bps })),
      rules: w.commissionRules.map((r) => ({ ...r, amountPaise: Math.round(r.amount * 100) })),
      skip: w.tenant.commissionSkip,
    });
    owedCommissionPaise = 0;
    for (const row of earned.values()) {
      const paid = w.ledger
        .filter((e) => e.type === "out" && e.category === "Commissions" && e.memberId === row.memberId && e.date.startsWith(ym))
        .reduce((a, e) => a + Math.round(e.amount * 100), 0);
      owedCommissionPaise += Math.max(0, row.totalPaise - paid);
    }
  }

  const p = profitFor({
    entries: entries.map((e) => ({ type: e.type, category: e.category, amountPaise: Math.round(e.amount * 100) })),
    owedSalaryPaise,
    owedCommissionPaise,
  });

  const line = (label: string, paise: number, opts: { strong?: boolean; tone?: "good" | "bad" | "muted"; sub?: boolean } = {}) => (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-[13px] ${opts.sub ? "pl-4" : ""}`}>
      <span className={opts.strong ? "fw-s" : opts.sub ? "text-mute2" : ""}>{label}</span>
      <span
        className={`tnum ${opts.strong ? "fw-s text-[15px]" : ""}`}
        style={{ color: opts.tone === "good" ? "#16A34A" : opts.tone === "bad" ? "#DC2626" : opts.tone === "muted" ? "#64748B" : undefined }}
      >
        {money(paise)}
      </span>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-line bg-white px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[15px]">Profit, {ymLabel(ym)}</h3>
        <span className="text-xs text-mute">The Net above, opened up</span>
      </div>

      {line("Income", p.incomePaise, { strong: true, tone: "good" })}
      {p.expenses.map((l) => (
        <div key={l.category}>{line(l.category, -l.paise, { sub: true })}</div>
      ))}
      <div className="my-1 border-t border-line3" />
      {line("Profit", p.netPaise, { strong: true, tone: p.netPaise >= 0 ? "good" : "bad" })}

      {m.payV ? (
        <>
          {(p.owedSalaryPaise ?? 0) > 0 && line("Salaries not yet paid", -(p.owedSalaryPaise ?? 0), { sub: true, tone: "muted" })}
          {(p.owedCommissionPaise ?? 0) > 0 && line("Commission earned, not yet paid", -(p.owedCommissionPaise ?? 0), { sub: true, tone: "muted" })}
          {(p.owedSalaryPaise ?? 0) + (p.owedCommissionPaise ?? 0) > 0 && (
            <>
              <div className="my-1 border-t border-line3" />
              {line("Profit after what is still owed", p.afterOwedPaise ?? 0, { strong: true, tone: (p.afterOwedPaise ?? 0) >= 0 ? "good" : "bad" })}
            </>
          )}
        </>
      ) : (
        <p className="m-0 mt-2 text-xs text-mute">Salaries and commission still owed are not included: they need Payroll access.</p>
      )}
    </div>
  );
}
