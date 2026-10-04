"use client";

import { useMemo, useState } from "react";
import { addCommissionRule, payCommission, removeCommissionRule, saveCommissionRate, setCommissionSkip } from "@/app/(app)/actions/commission";
import { commissionsFor, pct, rateOn, ruleApplies } from "@/lib/commission";
import { inr, ymLabel } from "@/lib/format";
import { useOps } from "../store";
import { CardGrid, StatCard } from "../ui";

const input = "h-8 rounded-lg border border-edge2 bg-white px-2.5 text-xs focus:border-accent focus:outline-none";
const btn = "fw-s h-8 rounded-lg border border-edge2 bg-white px-3 text-xs";
const primary = "fw-s h-8 rounded-lg border-0 bg-accent px-3 text-xs text-white hover:bg-accent-h disabled:opacity-50";

/**
 * Commissions for one month, inside the Payroll tab.
 *
 * The figures are worked out with the same function the server pays with
 * (src/lib/commission.ts). The server recomputes from everything when paying;
 * this screen can only use what the viewer was sent, which for an owner is
 * everything and for anyone else may be less - so it says so.
 */
export function Commissions({ ym, canEdit }: { ym: string; canEdit: boolean }) {
  const ops = useOps();
  const { w, m } = ops;
  const [open, setOpen] = useState<"" | "give" | "rates" | "skip">("");

  const rows = useMemo(
    () =>
      commissionsFor({
        ym,
        clients: w.clients.map((c) => ({ id: c.id, ownerId: c.ownerId })),
        entries: w.ledger.map((e) => ({
          type: e.type,
          status: e.status,
          clientId: e.clientId,
          date: e.date,
          category: e.category,
          amountPaise: Math.round(e.amount * 100),
        })),
        rates: w.commissionRates.map((r) => ({ memberId: r.memberId, from: r.from, bps: r.bps })),
        rules: w.commissionRules.map((r) => ({ ...r, amountPaise: Math.round(r.amount * 100) })),
        skip: w.tenant.commissionSkip,
      }),
    [w, ym],
  );

  const paidPaise = (memberId: string) =>
    w.ledger
      .filter((e) => e.type === "out" && e.category === "Commissions" && e.memberId === memberId && e.date.startsWith(ym))
      .reduce((a, e) => a + Math.round(e.amount * 100), 0);

  // Everybody with a commission this month, or a rate at all - a rate with no
  // money this month is still worth seeing on the screen where it is set.
  const people = m.team
    .filter((p) => p.status !== "Exited" && (rows.has(p.id) || w.commissionRates.some((r) => r.memberId === p.id)))
    .map((p) => {
      const r = rows.get(p.id);
      const total = r?.totalPaise ?? 0;
      const paid = paidPaise(p.id);
      const salary = p.onPayroll ? Math.round((p.salary ?? 0) * 100) : 0;
      return { p, r, total, paid, due: Math.max(0, total - paid), salary, rate: rateOn(w.commissionRates, p.id, `${ym}-31`) };
    })
    .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name));

  const totalCommission = people.reduce((a, x) => a + x.total, 0);
  const totalDue = people.reduce((a, x) => a + x.due, 0);
  const activeRules = w.commissionRules.filter((r) => ruleApplies(r, ym));
  const money = (paise: number) => inr(paise / 100);

  return (
    <>
      <div className="mb-2.5 mt-7 flex flex-wrap items-center gap-2">
        <h3 className="m-0 flex-1 text-[15px]">Commissions</h3>
        {canEdit && (
          <>
            <button type="button" className={btn} onClick={() => setOpen(open === "rates" ? "" : "rates")}>
              Rates
            </button>
            <button type="button" className={btn} onClick={() => setOpen(open === "skip" ? "" : "skip")}>
              What earns commission
            </button>
            <button type="button" className={primary} onClick={() => setOpen(open === "give" ? "" : "give")}>
              + Give commission
            </button>
          </>
        )}
      </div>
      <p className="m-0 mb-3 max-w-[78ch] text-xs text-mute">
        Each person earns their rate on the money their own clients actually paid this month, plus any commission given by
        hand. Paying it adds it to expenses under Commissions, so the month&apos;s profit already counts it.
        {!m.isOwner && " Worked out here from what you can see; the amount paid is worked out from everything."}
      </p>

      {open === "rates" && canEdit && <RateForm onDone={() => setOpen("")} />}
      {open === "skip" && canEdit && <SkipForm onDone={() => setOpen("")} />}
      {open === "give" && canEdit && <GiveForm ym={ym} onDone={() => setOpen("")} />}

      <CardGrid>
        <StatCard label={`Commission, ${ymLabel(ym)}`} value={money(totalCommission)} note={`${people.filter((x) => x.total).length} people`} />
        <StatCard label="Still to pay" value={money(totalDue)} color={totalDue ? "#D97706" : "#64748B"} note={totalDue ? "Earned, not yet paid" : "Nothing due"} />
        <StatCard
          label="Salary + commission"
          value={money(people.reduce((a, x) => a + x.salary + x.total, 0))}
          note="For the people below"
        />
      </CardGrid>

      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
        {people.map(({ p, r, total, paid, due, salary, rate }) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line3 px-5 py-[13px] text-[13px]">
            <span className="min-w-[160px] flex-[1_1_180px]">
              <span className="fw-s block">{p.name}</span>
              <span className="text-xs text-mute">
                {rate ? `${pct(rate)} of own clients` : "No rate"}
                {r?.autoBasePaise ? ` · ${money(r.autoBasePaise)} received` : ""}
              </span>
            </span>
            <span className="min-w-[90px]">
              <span className="block text-[11px] text-mute">Automatic</span>
              <span className="fw-s tnum">{money(r?.autoPaise ?? 0)}</span>
            </span>
            <span className="min-w-[90px]">
              <span className="block text-[11px] text-mute">By hand</span>
              <span className="fw-s tnum">{money(r?.rulePaise ?? 0)}</span>
            </span>
            <span className="min-w-[90px]">
              <span className="block text-[11px] text-mute">Commission</span>
              <span className="fw-s tnum">{money(total)}</span>
            </span>
            <span className="min-w-[110px]">
              <span className="block text-[11px] text-mute">Salary + commission</span>
              <span className="fw-s tnum">{money(salary + total)}</span>
            </span>
            <span className="min-w-[90px]">
              <span className="block text-[11px] text-mute">{due ? "Due" : "Paid"}</span>
              <span className="fw-s tnum" style={{ color: due ? "#B45309" : "#15803D" }}>
                {money(due || paid)}
              </span>
            </span>
            <span className="ml-auto">
              {canEdit && due > 0 && (
                <button type="button" className={primary} onClick={() => ops.run(payCommission({ memberId: p.id, ym }))}>
                  Pay {money(due)}
                </button>
              )}
            </span>
          </div>
        ))}
        {!people.length && (
          <div className="px-5 py-6 text-[13px] text-mute">
            No commission for {ymLabel(ym)}. Set a rate under Rates, or give one by hand.
          </div>
        )}
      </div>

      {activeRules.length > 0 && (
        <>
          <h4 className="mb-2 mt-4 text-[13px]">Given by hand, counting in {ymLabel(ym)}</h4>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            {activeRules.map((rule) => (
              <div key={rule.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line3 px-5 py-2.5 text-[13px]">
                <span className="fw-s min-w-[140px]">{m.P(rule.memberId).name}</span>
                <span className="flex-1 text-mute2">
                  {rule.kind === "fixed" ? inr(rule.amount) : `${pct(rule.bps)} of ${rule.clientId ? m.clientName(rule.clientId) : "a removed client"}`}
                  {rule.repeat === "monthly" ? ` every month from ${ymLabel(rule.fromMonth)}${rule.toMonth ? ` to ${ymLabel(rule.toMonth)}` : ""}` : " once"}
                  {rule.note ? ` · ${rule.note}` : ""}
                </span>
                {canEdit && (
                  <button type="button" aria-label="Remove commission" className="size-[28px] rounded-md border border-line2 bg-white text-[15px] leading-none text-mute" onClick={() => ops.run(removeCommissionRule(rule.id))}>
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

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 rounded-lg border border-line bg-[rgba(91,91,214,.04)] p-4 text-[13px]">{children}</div>;
}

/** Set a member's rate from a date. */
function RateForm({ onDone }: { onDone: () => void }) {
  const ops = useOps();
  const { w, m } = ops;
  const [memberId, setMemberId] = useState(m.active[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(m.today.slice(0, 8) + "01");
  const history = w.commissionRates.filter((r) => r.memberId === memberId).sort((a, b) => b.from.localeCompare(a.from));

  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-mute">
          Person
          <select className={`${input} mt-1 block min-w-[180px]`} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {m.active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Rate %
          <input className={`${input} mt-1 block w-24`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 10" />
        </label>
        <label className="text-xs text-mute">
          From
          <input className={`${input} mt-1 block`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <button
          type="button"
          className={primary}
          disabled={!memberId || value === ""}
          onClick={async () => {
            const r = await ops.run(saveCommissionRate({ memberId, pct: value, from }));
            if (r.ok) setValue("");
          }}
        >
          Save rate
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Close
        </button>
      </div>
      <p className="m-0 mt-2 text-xs text-mute">
        {history.length
          ? `History: ${history.map((r) => `${pct(r.bps)} from ${r.from}`).join(" · ")}. Money received before a change keeps the rate it was earned at.`
          : "No rate yet. Set 0 to stop the automatic commission without removing the history."}
      </p>
    </Panel>
  );
}

/** Which income categories earn no commission. */
function SkipForm({ onDone }: { onDone: () => void }) {
  const ops = useOps();
  const { w } = ops;
  const [skip, setSkip] = useState<string[]>(w.tenant.commissionSkip);

  return (
    <Panel>
      <p className="m-0 mb-2 text-xs text-mute">
        Untick income that should not earn commission. Wallet top-ups are mostly money passed on to Meta for messages, so
        they are usually left out.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {w.tenant.incomeCategories.map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={!skip.includes(c)}
              onChange={(e) => setSkip(e.target.checked ? skip.filter((x) => x !== c) : [...skip, c])}
            />
            {c}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={primary}
          onClick={async () => {
            const r = await ops.run(setCommissionSkip({ categories: skip }));
            if (r.ok) onDone();
          }}
        >
          Save
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}

/** Give anybody a commission, by hand. */
function GiveForm({ ym, onDone }: { ym: string; onDone: () => void }) {
  const ops = useOps();
  const { m } = ops;
  const [f, setF] = useState({
    memberId: m.active[0]?.id ?? "",
    kind: "fixed" as "fixed" | "percent",
    value: "",
    clientId: "",
    repeat: "once" as "once" | "monthly",
    fromMonth: ym,
    toMonth: "",
    note: "",
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });

  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-mute">
          To
          <select className={`${input} mt-1 block min-w-[170px]`} value={f.memberId} onChange={(e) => set({ memberId: e.target.value })}>
            {m.active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          As
          <select className={`${input} mt-1 block`} value={f.kind} onChange={(e) => set({ kind: e.target.value as "fixed" | "percent" })}>
            <option value="fixed">Fixed ₹</option>
            <option value="percent">% of a client&apos;s money</option>
          </select>
        </label>
        <label className="text-xs text-mute">
          {f.kind === "fixed" ? "Amount ₹" : "Percent"}
          <input className={`${input} mt-1 block w-24`} inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} placeholder={f.kind === "fixed" ? "e.g. 500" : "e.g. 5"} />
        </label>
        <label className="text-xs text-mute">
          Client {f.kind === "fixed" ? "(optional)" : ""}
          <select className={`${input} mt-1 block min-w-[170px]`} value={f.clientId} onChange={(e) => set({ clientId: e.target.value })}>
            <option value="">{f.kind === "fixed" ? "Not about one client" : "Pick a client"}</option>
            {m.vis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          How often
          <select className={`${input} mt-1 block`} value={f.repeat} onChange={(e) => set({ repeat: e.target.value as "once" | "monthly" })}>
            <option value="once">Once</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
        <label className="text-xs text-mute">
          {f.repeat === "once" ? "Month" : "From"}
          <input className={`${input} mt-1 block`} type="month" value={f.fromMonth} onChange={(e) => set({ fromMonth: e.target.value })} />
        </label>
        {f.repeat === "monthly" && (
          <label className="text-xs text-mute">
            Until (optional)
            <input className={`${input} mt-1 block`} type="month" value={f.toMonth} onChange={(e) => set({ toMonth: e.target.value })} />
          </label>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input className={`${input} min-w-[240px] flex-1`} value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="What for, e.g. onboarding Sharma Traders" />
        <button
          type="button"
          className={primary}
          disabled={!f.memberId || !f.value}
          onClick={async () => {
            const r = await ops.run(addCommissionRule(f));
            if (r.ok) onDone();
          }}
        >
          Give commission
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}
