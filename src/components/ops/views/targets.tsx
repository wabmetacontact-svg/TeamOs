"use client";

import { useMemo, useState } from "react";
import { removeTarget, setTarget } from "@/app/(app)/actions/targets";
import { dLabel, inr, ymAdd, ymLabel } from "@/lib/format";
import { targetRows, type Measure, type Period, type TargetRow } from "@/lib/targets";
import type { TargetW } from "@/lib/types";
import { useOps } from "../store";
import { LockNotice, MonthNav, Section } from "../ui";

const input = "h-8 rounded-lg border border-edge2 bg-white px-2.5 text-xs focus:border-accent focus:outline-none";
const primary = "fw-s h-8 rounded-lg border-0 bg-accent px-3 text-xs text-white hover:bg-accent-h disabled:opacity-50";
const btn = "fw-s h-8 rounded-lg border border-edge2 bg-white px-3 text-xs";

const paise = (r: number | null) => (r === null ? null : Math.round(r * 100));
const money = (p: number) => inr(p / 100);
const sales = (n: number) => String(n);

/**
 * Sales targets for a month - for the team and for any one person - against
 * what was achieved this month, this week and today. Targets are typed in;
 * everything achieved is counted from what WabMeta syncs.
 */
export function Targets() {
  const ops = useOps();
  const { w, m } = ops;
  const [ym, setYm] = useState(m.thisMonth);
  const [editing, setEditing] = useState<{ memberId: string } | null>(null);

  const monthTargets = useMemo(() => w.targets.filter((t) => t.month === ym), [w.targets, ym]);
  const rows = useMemo(
    () =>
      targetRows({
        ym,
        today: m.today,
        targets: monthTargets.map((t) => ({
          memberId: t.memberId,
          sales: t.sales,
          amountPaise: paise(t.amount),
          dailySales: t.dailySales,
          dailyAmountPaise: paise(t.dailyAmount),
        })),
        clients: w.clients.map((c) => ({ id: c.id, ownerId: c.ownerId, onboarderId: c.onboarderId, sinceDate: c.sinceDate })),
        entries: w.ledger.map((e) => ({ type: e.type, status: e.status, clientId: e.clientId, date: e.date, amountPaise: Math.round(e.amount * 100) })),
      }),
    [w.clients, w.ledger, monthTargets, ym, m.today],
  );

  if (!m.sees("targets")) {
    return <LockNotice>You don&apos;t have access to Targets. It is set on the Access screen.</LockNotice>;
  }

  const canEdit = m.edits("targets") && !m.previewing;
  const byMember = new Map(monthTargets.map((t) => [t.memberId ?? "", t]));
  const team = rows[0]!;
  const people = rows.slice(1).sort((a, b) => m.P(a.memberId!).name.localeCompare(m.P(b.memberId!).name));

  return (
    <>
      <MonthNav label={ymLabel(ym)} prev={() => setYm(ymAdd(ym, -1))} next={() => setYm(ymAdd(ym, 1))} today={() => setYm(m.thisMonth)} todayLabel="This month">
        {canEdit && (
          <button type="button" className={primary} onClick={() => setEditing(editing ? null : { memberId: "" })}>
            {editing ? "Close" : "+ Set target"}
          </button>
        )}
      </MonthNav>

      {editing && canEdit && (
        <TargetForm key={`${ym}-${editing.memberId}`} ym={ym} memberId={editing.memberId} existing={byMember} onDone={() => setEditing(null)} />
      )}

      <Section className="mb-3">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[15px]">Whole team</h2>
          <span className="flex-1" />
          {canEdit && (
            <button type="button" className="text-xs text-accent underline" onClick={() => setEditing({ memberId: "" })}>
              {byMember.has("") ? "Change target" : "Set a team target"}
            </button>
          )}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))" }}>
          <PeriodCard title={ymLabel(ym)} p={team.month} />
          {team.week && <PeriodCard title={`This week · ${dLabel(team.week.from)} – ${dLabel(team.week.to)}`} p={team.week} />}
          {team.today && <PeriodCard title="Today" p={team.today} />}
        </div>
        <Needed row={team} />
      </Section>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-mute">
              <th className="px-4 py-3 font-normal">Person</th>
              <th className="px-3 py-3 font-normal">Sales, month</th>
              <th className="px-3 py-3 font-normal">Amount, month</th>
              {team.week && <th className="px-3 py-3 font-normal">This week</th>}
              {team.today && <th className="px-3 py-3 font-normal">Today</th>}
              {team.week && <th className="px-3 py-3 font-normal">Needed per day</th>}
              {canEdit && <th className="w-[1%] px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {people.map((r) => (
              <tr key={r.memberId} className="border-b border-line3 align-top">
                <td className="fw-s px-4 py-3">{m.P(r.memberId!).name}</td>
                <td className="px-3 py-3">
                  <Progress q={r.month.sales} fmt={sales} />
                </td>
                <td className="px-3 py-3">
                  <Progress q={r.month.amount} fmt={money} />
                </td>
                {r.week && (
                  <td className="px-3 py-3">
                    <Compact p={r.week} />
                  </td>
                )}
                {r.today && (
                  <td className="px-3 py-3">
                    <Compact p={r.today} />
                  </td>
                )}
                {r.perDayNeeded && (
                  <td className="tnum px-3 py-3 text-xs text-mute2">
                    <NeededText row={r} />
                  </td>
                )}
                {canEdit && (
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button type="button" className={btn} onClick={() => setEditing({ memberId: r.memberId! })}>
                      Change
                    </button>{" "}
                    <button
                      type="button"
                      aria-label="Remove target"
                      className="size-[28px] rounded-md border border-line2 bg-white text-[15px] leading-none text-mute"
                      onClick={() => ops.run(removeTarget(byMember.get(r.memberId!)!.id))}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!people.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-mute">
                  No one has a target for {ymLabel(ym)}.{canEdit && " Set one for a salesperson or an onboarder with “+ Set target”."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mx-0.5 mt-2.5 max-w-[85ch] text-xs text-mute">
        Sales are clients who joined in the period; amount is money received from clients in it. Both come from WabMeta.
        A person&apos;s figures count the clients they sold or are onboarding, so one client can count for two people and
        once for the team.
        {!m.isOwner && " Counted from the clients and money you can see."}
      </p>
    </>
  );
}

function PeriodCard({ title, p }: { title: string; p: Period }) {
  return (
    <div className="rounded-[10px] border border-line px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-[.1em] text-mute">{title}</div>
      <div className="mt-2.5 grid gap-3">
        <div>
          <div className="mb-1 text-xs text-mute2">Sales</div>
          <Progress q={p.sales} fmt={sales} big />
        </div>
        <div>
          <div className="mb-1 text-xs text-mute2">Amount received</div>
          <Progress q={p.amount} fmt={money} big />
        </div>
      </div>
      {p.prorated && <div className="mt-2 text-[11px] text-faint">Target is the month&apos;s, spread over its days.</div>}
    </div>
  );
}

/** Done against target, a bar, and what is left. */
function Progress({ q, fmt, big }: { q: Measure; fmt: (n: number) => string; big?: boolean }) {
  const pct = q.target ? Math.min(100, (q.done / q.target) * 100) : q.target === 0 ? 100 : 0;
  const met = q.target !== null && q.left === 0;
  return (
    <div className="min-w-[130px]">
      <div className={`tnum ${big ? "fw-s text-lg" : "text-[13px]"}`}>
        {fmt(q.done)}
        {q.target !== null && <span className="text-mute"> / {fmt(q.target)}</span>}
      </div>
      {q.target !== null && (
        <>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-tint2">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: met ? "#16A34A" : "#5B5BD6" }} />
          </div>
          <div className="mt-1 text-[11px]" style={{ color: met ? "#16A34A" : undefined }}>
            {met ? "Target met" : <span className="text-mute">{fmt(q.left!)} left</span>}
          </div>
        </>
      )}
      {q.target === null && <div className="mt-0.5 text-[11px] text-faint">No target</div>}
    </div>
  );
}

/** A week or a day in one cell: sales and amount, each done of target. */
function Compact({ p }: { p: Period }) {
  const line = (q: Measure, fmt: (n: number) => string, unit: string) => (
    <div className="tnum">
      {fmt(q.done)}
      {q.target !== null && <span className="text-mute"> / {fmt(q.target)}</span>}
      <span className="text-mute"> {unit}</span>
      {q.target !== null && q.left === 0 && <span className="text-[#16A34A]"> ✓</span>}
    </div>
  );
  return (
    <div className="text-xs leading-5">
      {line(p.sales, sales, "sales")}
      {line(p.amount, money, "")}
    </div>
  );
}

function NeededText({ row }: { row: TargetRow }) {
  const n = row.perDayNeeded;
  if (!n || (n.sales === null && n.amountPaise === null)) return <>—</>;
  const parts: string[] = [];
  if (n.sales !== null) parts.push(n.sales === 0 ? "0 sales" : `${n.sales < 10 ? n.sales.toFixed(1) : Math.ceil(n.sales)} sales`);
  if (n.amountPaise !== null) parts.push(money(n.amountPaise));
  return <>{parts.join(" · ")}</>;
}

function Needed({ row }: { row: TargetRow }) {
  const n = row.perDayNeeded;
  if (!n || (n.sales === null && n.amountPaise === null)) return null;
  return (
    <p className="m-0 mt-3 text-xs text-mute2">
      To reach this month&apos;s target, each day left (today included) needs <span className="fw-s text-ink"><NeededText row={row} /></span>.
    </p>
  );
}

function TargetForm({ ym, memberId, existing, onDone }: { ym: string; memberId: string; existing: Map<string, TargetW>; onDone: () => void }) {
  const ops = useOps();
  const { m } = ops;
  const fill = (id: string, month: string) => {
    const t = month === ym ? existing.get(id) : undefined;
    const s = (v: number | null) => (v === null || v === undefined ? "" : String(v));
    return { memberId: id, month, sales: s(t?.sales ?? null), amount: s(t?.amount ?? null), dailySales: s(t?.dailySales ?? null), dailyAmount: s(t?.dailyAmount ?? null) };
  };
  const [f, setF] = useState(() => fill(memberId, ym));
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const num = (v: string) => v.replace(/\D/g, "");

  return (
    <div className="mb-3 rounded-lg border border-line bg-[rgba(91,91,214,.04)] p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-mute">
          For
          <select className={`${input} mt-1 block min-w-[170px]`} value={f.memberId} onChange={(e) => setF(fill(e.target.value, f.month))}>
            <option value="">Whole team</option>
            {m.active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Month
          <input className={`${input} mt-1 block`} type="month" value={f.month} onChange={(e) => set({ month: e.target.value })} />
        </label>
        <label className="text-xs text-mute">
          Sales this month
          <input className={`${input} mt-1 block w-28`} inputMode="numeric" value={f.sales} onChange={(e) => set({ sales: num(e.target.value) })} placeholder="e.g. 30" />
        </label>
        <label className="text-xs text-mute">
          Amount this month ₹
          <input className={`${input} mt-1 block w-32`} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 500000" />
        </label>
        <label className="text-xs text-mute">
          Sales per day
          <input className={`${input} mt-1 block w-24`} inputMode="numeric" value={f.dailySales} onChange={(e) => set({ dailySales: num(e.target.value) })} placeholder="optional" />
        </label>
        <label className="text-xs text-mute">
          Amount per day ₹
          <input className={`${input} mt-1 block w-28`} inputMode="decimal" value={f.dailyAmount} onChange={(e) => set({ dailyAmount: e.target.value })} placeholder="optional" />
        </label>
        <button
          type="button"
          className={primary}
          disabled={!f.sales && !f.amount && !f.dailySales && !f.dailyAmount}
          onClick={async () => {
            const r = await ops.run(setTarget(f));
            if (r.ok) onDone();
          }}
        >
          Save
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="m-0 mt-2 text-[11px] text-mute">
        Leave a box empty for no target. Without a per-day figure, the week and today use the month&apos;s target spread over its days.
      </p>
    </div>
  );
}
