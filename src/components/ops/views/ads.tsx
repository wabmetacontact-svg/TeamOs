"use client";

import { useMemo, useState } from "react";
import { addAdSpend, removeAdSpend } from "@/app/(app)/actions/ads";
import { funnelFor, periodLabel, periodRange, type Period } from "@/lib/ads";
import { MN, addDays, dLong, inr, ymAdd } from "@/lib/format";
import { useOps } from "../store";
import { CardGrid, LockNotice, MonthNav, StatCard } from "../ui";

const input = "h-8 rounded-lg border border-edge2 bg-white px-2.5 text-xs focus:border-accent focus:outline-none";
const primary = "fw-s h-8 rounded-lg border-0 bg-accent px-3 text-xs text-white hover:bg-accent-h disabled:opacity-50";
const btn = "fw-s h-8 rounded-lg border border-edge2 bg-white px-3 text-xs";

const money = (paise: number | null) => (paise === null ? "—" : inr(paise / 100));
const ratio = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const times = (x: number | null) => (x === null ? "—" : `${x.toFixed(2)}×`);
/** Leads can be a share of an entry spread over days; whole leads are shown. */
const leadsOf = (n: number) => Math.round(n);

const PERIODS: [Period, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

const SPAN: Record<Period, string> = { day: "this day", week: "this week", month: "this month" };
const NOW: Record<Period, string> = { day: "Today", week: "This week", month: "This month" };

/** What the navigator shows for the window. */
function windowLabel(period: Period, from: string, to: string): string {
  if (period === "day") return dLong(from);
  if (period === "month") return periodLabel("month", from);
  const [, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return fm === tm ? `${fd} – ${td} ${MN[tm - 1]} ${ty}` : `${fd} ${MN[fm - 1]} – ${td} ${MN[tm - 1]} ${ty}`;
}

/** The same kind of window, n steps away. */
function step(period: Period, day: string, n: number): string {
  if (period === "day") return addDays(day, n);
  if (period === "week") return addDays(day, 7 * n);
  return `${ymAdd(day.slice(0, 7), n)}-01`;
}

/**
 * Ads to revenue, per person, for a day, a week or a month. Spend and leads
 * are typed in for a day, a week or a month; sales and revenue are counted
 * from the clients each person brought in.
 */
export function Ads() {
  const ops = useOps();
  const { w, m } = ops;
  const [period, setPeriod] = useState<Period>("month");
  const [day, setDay] = useState(m.today);
  const [adding, setAdding] = useState(false);
  const { from, to } = periodRange(period, day);

  const rows = useMemo(
    () =>
      funnelFor({
        from,
        to,
        spends: w.adSpends.map((s) => ({ memberId: s.memberId, from: s.from, to: s.to, amountPaise: Math.round(s.amount * 100), leads: s.leads })),
        clients: w.clients.map((c) => ({ id: c.id, ownerId: c.ownerId, sinceDate: c.sinceDate })),
        entries: w.ledger.map((e) => ({ type: e.type, status: e.status, clientId: e.clientId, date: e.date, amountPaise: Math.round(e.amount * 100) })),
      }),
    [w, from, to],
  );

  // The shell already refuses a viewer with no Ads access; this covers the
  // component being used anywhere else.
  if (!m.sees("ads")) {
    return <LockNotice>You don&apos;t have access to Ads. It is set on the Access screen.</LockNotice>;
  }

  const canEdit = m.edits("ads") && !m.previewing;
  const spend = rows.reduce((a, r) => a + r.spendPaise, 0);
  const leads = leadsOf(rows.reduce((a, r) => a + r.leads, 0));
  const sales = rows.reduce((a, r) => a + r.sales, 0);
  const revenue = rows.reduce((a, r) => a + r.revenuePaise, 0);
  const inView = w.adSpends.filter((s) => s.from <= to && s.to >= from).sort((a, b) => a.from.localeCompare(b.from));
  const label = windowLabel(period, from, to);
  const span = SPAN[period];

  return (
    <>
      <MonthNav label={label} prev={() => setDay(step(period, day, -1))} next={() => setDay(step(period, day, 1))} today={() => setDay(m.today)} todayLabel={NOW[period]}>
        <div className="flex rounded-lg border border-edge2 bg-white p-0.5" role="group" aria-label="Show ads per">
          {PERIODS.map(([p, name]) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              className={`fw-s h-7 rounded-md px-3 text-xs ${period === p ? "bg-accent text-white" : "text-mute2"}`}
              onClick={() => setPeriod(p)}
            >
              {name}
            </button>
          ))}
        </div>
        {canEdit && (
          <button type="button" className={primary} onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "+ Add ad spend"}
          </button>
        )}
      </MonthNav>

      {adding && canEdit && <AddForm key={`${period}-${from}`} period={period} day={period === "month" ? from : day} onDone={() => setAdding(false)} />}

      <CardGrid>
        <StatCard label="Spent on ads" value={money(spend)} note={`${leads} lead${leads === 1 ? "" : "s"}`} />
        <StatCard label="New clients" value={String(sales)} note={leads ? `${ratio(sales / leads)} of leads` : `Joined ${span}`} />
        <StatCard label="Revenue from them" value={money(revenue)} color="#16A34A" note={spend ? `${times(revenue / spend)} what was spent` : `Paid ${span}`} />
        <StatCard label="Cost per new client" value={sales && spend ? money(Math.round(spend / sales)) : "—"} />
      </CardGrid>
      <p className="mx-0.5 mb-3 mt-2.5 max-w-[80ch] text-xs text-mute">
        New clients are those credited to the person who joined {span}; revenue is what those new clients paid {span}. Spend
        recorded for a longer stretch counts here for its days that fall {span}. Spend is also in expenses under Ads, so
        profit already counts it.
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-mute">
              <th className="px-4 py-3 font-normal">Person</th>
              <th className="px-3 py-3 text-right font-normal">Spend</th>
              <th className="px-3 py-3 text-right font-normal">Leads</th>
              <th className="px-3 py-3 text-right font-normal">Cost / lead</th>
              <th className="px-3 py-3 text-right font-normal">New clients</th>
              <th className="px-3 py-3 text-right font-normal">Conversion</th>
              <th className="px-3 py-3 text-right font-normal">Cost / client</th>
              <th className="px-3 py-3 text-right font-normal">Revenue</th>
              <th className="px-4 py-3 text-right font-normal">Return</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-b border-line3">
                <td className="fw-s px-4 py-2.5">{m.P(r.memberId).name}</td>
                <td className="tnum px-3 py-2.5 text-right">{money(r.spendPaise)}</td>
                <td className="tnum px-3 py-2.5 text-right">{leadsOf(r.leads)}</td>
                <td className="tnum px-3 py-2.5 text-right">{money(r.costPerLeadPaise)}</td>
                <td className="tnum px-3 py-2.5 text-right">{r.sales}</td>
                <td className="tnum px-3 py-2.5 text-right">{ratio(r.conversion)}</td>
                <td className="tnum px-3 py-2.5 text-right">{money(r.costPerSalePaise)}</td>
                <td className="tnum fw-s px-3 py-2.5 text-right" style={{ color: r.revenuePaise ? "#16A34A" : undefined }}>
                  {money(r.revenuePaise)}
                </td>
                <td
                  className="tnum px-4 py-2.5 text-right"
                  style={{ color: r.returnOnSpend === null ? undefined : r.returnOnSpend >= 1 ? "#16A34A" : "#DC2626" }}
                >
                  {times(r.returnOnSpend)}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-mute">
                  Nothing for {label}. Add ad spend, or credit new clients to the people who brought them in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {inView.length > 0 && (
        <>
          <h4 className="mb-2 mt-4 text-[13px]">Ad spend recorded for {label}</h4>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            {inView.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line3 px-5 py-2.5 text-[13px]">
                <span className="fw-s min-w-[140px]">{m.P(s.memberId).name}</span>
                <span className="min-w-[150px] text-mute2">{periodLabel(s.period, s.from)}</span>
                <span className="tnum min-w-[90px]">{inr(s.amount)}</span>
                <span className="min-w-[80px] text-mute2">
                  {s.leads} lead{s.leads === 1 ? "" : "s"}
                </span>
                <span className="flex-1 text-mute">{s.note}</span>
                {canEdit && (
                  <button
                    type="button"
                    aria-label="Remove ad spend"
                    className="size-[28px] rounded-md border border-line2 bg-white text-[15px] leading-none text-mute"
                    onClick={() => ops.run(removeAdSpend(s.id))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function AddForm({ period, day, onDone }: { period: Period; day: string; onDone: () => void }) {
  const ops = useOps();
  const { m } = ops;
  const [f, setF] = useState({ memberId: m.active[0]?.id ?? "", period, date: day, amount: "", leads: "", note: "" });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const week = periodRange("week", f.date);

  return (
    <div className="mb-3 rounded-lg border border-line bg-[rgba(91,91,214,.04)] p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-mute">
          For
          <select className={`${input} mt-1 block min-w-[170px]`} value={f.memberId} onChange={(e) => set({ memberId: e.target.value })}>
            {m.active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Per
          <select className={`${input} mt-1 block`} value={f.period} onChange={(e) => set({ period: e.target.value as Period })}>
            {PERIODS.map(([p, name]) => (
              <option key={p} value={p}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          {f.period === "day" ? "Day" : f.period === "week" ? "Any day in the week" : "Month"}
          {f.period === "month" ? (
            <input className={`${input} mt-1 block`} type="month" value={f.date.slice(0, 7)} onChange={(e) => e.target.value && set({ date: `${e.target.value}-01` })} />
          ) : (
            <input className={`${input} mt-1 block`} type="date" value={f.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          )}
        </label>
        <label className="text-xs text-mute">
          Spent ₹
          <input className={`${input} mt-1 block w-28`} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 15000" />
        </label>
        <label className="text-xs text-mute">
          Leads
          <input className={`${input} mt-1 block w-20`} inputMode="numeric" value={f.leads} onChange={(e) => set({ leads: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 60" />
        </label>
        <input className={`${input} min-w-[200px] flex-1`} value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="Campaign, e.g. Meta - Diwali offer" />
        <button
          type="button"
          className={primary}
          disabled={!f.memberId || (!f.amount && !f.leads)}
          onClick={async () => {
            const r = await ops.run(addAdSpend(f));
            if (r.ok) onDone();
          }}
        >
          Save
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancel
        </button>
      </div>
      {f.period === "week" && <p className="m-0 mt-2 text-[11px] text-mute">Records the week {windowLabel("week", week.from, week.to)}, Monday to Sunday.</p>}
    </div>
  );
}
