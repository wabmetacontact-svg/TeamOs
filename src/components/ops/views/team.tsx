"use client";

import { useState } from "react";
import { dLabel, dLong, dayDiff, initials, inr, inrShort, ymAdd, ymLabel } from "@/lib/format";
import { decideLeave, removeHrDept } from "@/app/(app)/actions/team";
import { paySalary, payAllSalaries } from "@/app/(app)/actions/ledger";
import { salesByMember, unownedClients } from "@/lib/sales";
import { Commissions } from "./commissions";
import { openModal } from "../modals";
import { useOps, useWide } from "../store";
import { CardGrid, Chip, DashedAdd, LockNotice, MonthNav, StatCard, Tabs, TextLink } from "../ui";

type Tab = "members" | "kpi" | "sales" | "payroll";

export function TeamView() {
  const ops = useOps();
  const { w, m } = ops;
  const [tab, setTab] = useState<Tab>("members");
  const approved = w.leaves.filter((l) => l.status === "approved");
  const onLeave = approved.filter((l) => l.from <= m.today && l.to >= m.today);
  const payroll = m.team.filter((p) => p.status !== "Exited").reduce((a, p) => a + (p.salary ?? 0), 0);
  const pending = w.leaves.filter((l) => l.status === "pending").length;

  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {[
          { label: "Headcount", value: String(m.team.filter((p) => p.status !== "Exited").length), note: `${m.team.filter((p) => p.type === "Full-time" && p.status !== "Exited").length} full-time` },
          { label: "On leave today", value: String(onLeave.length), note: onLeave.map((l) => m.P(l.memberId).name).join(", ") || "Everyone in" },
          { label: "Leave requests pending", value: String(pending), note: m.teamAdmin ? "Awaiting your decision" : "Decided by the founder or a team admin" },
          { label: "Monthly payroll", value: m.payV ? inrShort(payroll) : "Restricted", note: "Before statutory deductions" },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-line bg-white px-[18px] py-4">
            <div className="text-xs text-mute">{k.label}</div>
            <div className="fw-s tnum mt-1 text-[23px] leading-[1.1] tracking-[-.02em] text-ink2">{k.value}</div>
            <div className="text-xs text-mute">{k.note}</div>
          </div>
        ))}
      </div>
      <Tabs
        className="mb-4 mt-5"
        active={tab}
        onPick={setTab}
        tabs={[
          ["members", "Members"],
          ["kpi", "KPIs"],
          ["sales", "Sales"],
          ["payroll", "Payroll"],
        ]}
      />
      {tab === "members" && <Members />}
      {tab === "kpi" && <Kpis />}
      {tab === "sales" && <Sales />}
      {tab === "payroll" && <Payroll />}
    </>
  );
}

function Members() {
  const ops = useOps();
  const { w, m } = ops;
  const wide = useWide();
  const [dept, setDept] = useState("all");
  const rows = m.team.filter((p) => dept === "all" || p.dept === dept);
  const editTeam = m.edits("team") && !m.previewing;
  const cols = wide ? "minmax(0,2.2fr) repeat(5,minmax(0,1fr))" : "1fr 1fr";

  const leaves = [...w.leaves].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.from.localeCompare(a.from));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip active={dept === "all"} label="All departments" onClick={() => setDept("all")} />
        {w.tenant.hrDepartments.map((d) => (
          <Chip
            key={d}
            active={dept === d}
            label={d}
            onClick={() => setDept(d)}
            onRemove={m.teamAdmin && !m.previewing ? () => ops.run(removeHrDept({ name: d })).then((r) => r.ok && dept === d && setDept("all")) : undefined}
            removeTitle="Remove department"
          />
        ))}
        {editTeam && (
          <DashedAdd onClick={() => ops.setQuick({ kind: "dept", target: "none", field: "dept", form: { name: "" }, error: "", busy: false })}>
            + Add department
          </DashedAdd>
        )}
        <span className="flex-1" />
        {editTeam && (
          <button type="button" onClick={() => openModal(ops, "member")} className="fw-s h-[34px] rounded-full border-0 bg-ink2 px-4 text-xs text-white">
            + Add team member
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        {wide && (
          <div className="grid gap-3 border-b border-line px-5 py-3 text-[11px] uppercase tracking-[.06em] text-mute" style={{ gridTemplateColumns: cols }}>
            <span>Member</span>
            <span>Status</span>
            <span>Type</span>
            <span>Joined</span>
            <span>Leave left</span>
            <span className="text-right">Monthly pay</span>
          </div>
        )}
        {rows.map((p) => {
          const act = p.status === "Active";
          const sBg = act ? "#DCFCE7" : p.status === "On leave" ? "#DBEAFE" : p.status === "Probation" ? "#FEF3C7" : "#F1F5F9";
          const sFg = act ? "#15803D" : p.status === "On leave" ? "#1D4ED8" : p.status === "Probation" ? "#B45309" : "#475569";
          const pay = p.onPayroll ? (m.payV && p.salary != null ? inr(p.salary) : "Restricted") : "Not on payroll";
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => ops.setDrawer({ type: "person", id: p.id })}
              className="grid w-full items-center gap-x-3 gap-y-2 border-0 border-b border-line3 bg-transparent px-5 py-[13px] text-left text-[13px] hover:bg-[rgba(91,91,214,.06)]"
              style={{ gridTemplateColumns: cols }}
            >
              <span className="flex min-w-0 items-center gap-3" style={{ gridColumn: wide ? "auto" : "1 / -1" }}>
                <span className="fw-s flex size-9 shrink-0 items-center justify-center rounded bg-[rgba(91,91,214,.14)] text-xs text-ink2">{initials(p.name)}</span>
                <span className="min-w-0">
                  <span className="fw-s block">{p.name}</span>
                  <span className="text-xs text-mute">
                    {p.title}
                    {p.dept ? ` · ${p.dept}` : ""}
                  </span>
                </span>
              </span>
              <span>
                <span className="fw-s rounded-full px-2.5 py-[3px] text-[11px]" style={{ background: sBg, color: sFg }}>
                  {p.status}
                </span>
              </span>
              <span>{p.type}</span>
              <span>{p.start ? dLong(p.start) : "—"}</span>
              <span>
                {p.leaveTotal - p.leaveUsed} of {p.leaveTotal} days
              </span>
              <span className="fw-s" style={{ textAlign: wide ? "right" : "left", color: m.payV && p.onPayroll ? "#0F172A" : "#64748B" }}>
                {pay}
              </span>
            </button>
          );
        })}
        {!rows.length && <p className="m-0 px-5 py-4 text-[13px] text-mute">Nobody in this department.</p>}
      </div>

      <section className="mt-4 rounded-lg border border-line bg-white p-5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-[15px]">Leave requests</h2>
          {!m.previewing && <TextLink onClick={() => openModal(ops, "leave")}>+ Add leave request</TextLink>}
        </div>
        {leaves.map((l) => {
          const days = dayDiff(l.to, l.from) + 1;
          const st = l.status;
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-[rgba(100,116,139,.15)] py-3 text-[13px]">
              <span className="min-w-0 flex-[1_1_220px]">
                <span className="fw-s block">
                  {m.P(l.memberId).name} · {l.type} leave
                </span>
                <span className="text-xs text-mute">
                  {l.from === l.to ? dLabel(l.from) : `${dLabel(l.from)} to ${dLabel(l.to)}`} · {days} {days === 1 ? "day" : "days"} · {l.note}
                </span>
              </span>
              {st === "pending" && m.teamAdmin && l.memberId !== m.me.id && !m.previewing && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => ops.run(decideLeave({ id: l.id, approve: false }))}
                    className="fw-s h-8 rounded-full border border-[rgba(100,116,139,.4)] bg-white px-3.5 text-xs"
                  >
                    Decline
                  </button>
                  <button type="button" onClick={() => ops.run(decideLeave({ id: l.id, approve: true }))} className="fw-s h-8 rounded-full border-0 bg-accent px-3.5 text-xs text-white">
                    Approve
                  </button>
                </div>
              )}
              <span
                className="fw-s rounded-full px-2.5 py-[3px] text-[11px]"
                style={{
                  background: st === "approved" ? "#DCFCE7" : st === "pending" ? "#FEF3C7" : "#F1F5F9",
                  color: st === "approved" ? "#15803D" : st === "pending" ? "#B45309" : "#475569",
                }}
              >
                {st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Declined"}
              </span>
            </div>
          );
        })}
        {!leaves.length && <p className="m-0 text-[13px] text-mute">No leave requests yet.</p>}
      </section>
    </>
  );
}

function Kpis() {
  const ops = useOps();
  const { w, m } = ops;
  const [all, setAll] = useState(true);
  const [ym, setYm] = useState(m.thisMonth);
  const tasks = w.tasks.filter((t) => all || (t.due || t.created).startsWith(ym));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  const rows = m.team
    .map((p) => {
      const mine = tasks.filter((t) => t.whoId === p.id);
      const done = mine.filter((t) => t.status === "done");
      const onTime = done.filter((t) => !m.lateDays(t));
      const late = done.filter((t) => m.lateDays(t) > 0);
      const blocked = mine.filter((t) => t.status === "blocked").length;
      const overdue = mine.filter((t) => t.status !== "done" && m.lateDays(t) > 0).length;
      const verified = done.filter((t) => t.verified).length;
      const avg = late.length ? `${(late.reduce((a, t) => a + m.lateDays(t), 0) / late.length).toFixed(1)}d` : "—";
      const rate = mine.length ? done.length / mine.length : 0;
      const color = rate >= 0.85 ? "#16A34A" : rate >= 0.6 ? "#D97706" : "#DC2626";
      return { p, total: mine.length, done: done.length, rate, color, onTime: pct(onTime.length, done.length), avg, blocked, overdue, verified: pct(verified, done.length) };
    })
    .filter((r) => r.total > 0);

  const toggle = (on: boolean) => ({ background: on ? "#111827" : "#fff", color: on ? "#fff" : "#0F172A" });

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!all) setYm(ymAdd(ym, -1));
            setAll(false);
          }}
          className="size-[34px] rounded-lg border border-edge2 bg-white"
        >
          ‹
        </button>
        <span className="fw-s min-w-[130px] text-center text-sm">{all ? "All time" : ymLabel(ym)}</span>
        <button
          type="button"
          onClick={() => {
            if (!all) setYm(ymAdd(ym, 1));
            setAll(false);
          }}
          className="size-[34px] rounded-lg border border-edge2 bg-white"
        >
          ›
        </button>
        {!all && <span className="text-xs text-mute">Tasks due this month</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => setAll(false)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(!all)}>
          By month
        </button>
        <button type="button" onClick={() => setAll(true)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(all)}>
          All time
        </button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
        {rows.map((r) => (
          <button
            key={r.p.id}
            type="button"
            onClick={() => ops.setDrawer({ type: "person", id: r.p.id })}
            className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-white p-4 text-left text-[13px] hover:border-accent-l"
          >
            <span className="flex items-center gap-2.5">
              <span className="fw-s flex size-9 items-center justify-center rounded-full bg-accent-s text-xs text-indigo">{initials(r.p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="fw-s block">{r.p.name}</span>
                <span className="text-xs text-mute">{r.p.title}</span>
              </span>
              <span className="fw-s tnum text-[22px]" style={{ color: r.color }}>
                {pct(r.done, r.total)}
              </span>
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-tint2">
              <span className="block h-full" style={{ width: `${Math.round(r.rate * 100)}%`, background: r.color }} />
            </span>
            <span className="grid grid-cols-3 gap-x-2 gap-y-2.5">
              {[
                ["Completed", `${r.done} / ${r.total}`, undefined],
                ["On time", r.onTime, undefined],
                ["Avg delay", r.avg, undefined],
                ["Overdue", String(r.overdue), r.overdue ? "#DC2626" : "#0F172A"],
                ["Blocked", String(r.blocked), undefined],
                ["Verified", r.verified, undefined],
              ].map(([label, value, color]) => (
                <span key={label}>
                  <span className="block text-[11px] text-mute">{label}</span>
                  <span className="fw-s" style={{ color }}>
                    {value}
                  </span>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <div className="rounded-xl border border-dashed border-edge3 bg-white px-5 py-7 text-[13px] text-mute">
          {all ? "No tasks assigned yet." : "No tasks due in this month."}
        </div>
      )}
    </>
  );
}

/**
 * What each person brought in.
 *
 * Three different things on one card, because judging a salesperson on any one
 * of them alone is misleading: the clients they are credited with, the money
 * those clients actually paid, and whether they are keeping up with their own
 * work. A big book with nothing received is a different problem from a small
 * book that pays on time.
 *
 * Revenue is money RECEIVED, never what is billed - the same rule the rest of
 * this app follows. The monthly figure is shown beside it as the recurring
 * book, not as income.
 *
 * Only people with at least one client appear. A workspace where nobody is
 * credited with anything says so, rather than listing every employee with four
 * dashes against their name.
 */
function Sales() {
  const ops = useOps();
  const { w, m } = ops;
  const [all, setAll] = useState(true);
  const [ym, setYm] = useState(m.thisMonth);

  const inWindow = (date: string) => all || date.startsWith(ym);

  // The arithmetic is in src/lib/sales.ts, with its own tests. Money adding up
  // correctly is not something to verify by looking at a screen.
  const rows = salesByMember({
    members: m.team,
    clients: w.clients,
    ledger: w.ledger,
    tasks: w.tasks,
    financeClientIds: m.finIds,
    inWindow,
    doneAt: m.doneAt,
    lateDays: m.lateDays,
  }).map((r) => ({ ...r, p: m.P(r.memberId) }));

  const toggle = (on: boolean) => ({ background: on ? "#111827" : "#fff", color: on ? "#fff" : "#0F172A" });
  const totalReceived = rows.reduce((a, r) => a + r.received, 0);
  const unowned = unownedClients(w.clients);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!all) setYm(ymAdd(ym, -1));
            setAll(false);
          }}
          className="size-[34px] rounded-lg border border-edge2 bg-white"
        >
          ‹
        </button>
        <span className="fw-s min-w-[130px] text-center text-sm">{all ? "All time" : ymLabel(ym)}</span>
        <button
          type="button"
          onClick={() => {
            if (!all) setYm(ymAdd(ym, 1));
            setAll(false);
          }}
          className="size-[34px] rounded-lg border border-edge2 bg-white"
        >
          ›
        </button>
        {!!rows.length && <span className="text-xs text-mute">{inr(totalReceived)} received in all</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => setAll(false)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(!all)}>
          By month
        </button>
        <button type="button" onClick={() => setAll(true)} className="fw-s h-[30px] rounded-full border border-edge2 px-3 text-xs" style={toggle(all)}>
          All time
        </button>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
        {rows.map((r) => (
          <button
            key={r.p.id}
            type="button"
            onClick={() => ops.setDrawer({ type: "person", id: r.p.id })}
            className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-white p-4 text-left text-[13px] hover:border-accent-l"
          >
            <span className="flex items-center gap-2.5">
              <span className="fw-s flex size-9 items-center justify-center rounded-full bg-accent-s text-xs text-indigo">{initials(r.p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="fw-s block">{r.p.name}</span>
                <span className="text-xs text-mute">{r.p.title}</span>
              </span>
              <span className="fw-s tnum text-right text-[18px] leading-tight">{inrShort(r.received)}</span>
            </span>
            <span className="grid grid-cols-3 gap-x-2 gap-y-2.5">
              {[
                ["Clients", String(r.clients)],
                ["Received", inrShort(r.received)],
                ["Per month", inrShort(r.bookPerMonth)],
                ["Tasks done", String(r.tasksDone)],
                ["Overdue", String(r.tasksOverdue)],
                // Clients handed to them to set up - workload, not sales.
                ["Onboarding", String(r.onboarding)],
              ].map(([label, value], i) =>
                label ? (
                  <span key={label}>
                    <span className="block text-[11px] text-mute">{label}</span>
                    <span className="fw-s" style={{ color: label === "Overdue" && r.tasksOverdue ? "#DC2626" : undefined }}>
                      {value}
                    </span>
                  </span>
                ) : (
                  <span key={`gap-${i}`} />
                ),
              )}
            </span>
            {!!r.hiddenClients && (
              <span className="block text-[11px] text-mute">
                {r.hiddenClients} of their client{r.hiddenClients === 1 ? "" : "s"} is not yours to see the money on, so this total is
                partial.
              </span>
            )}
          </button>
        ))}
      </div>

      {!rows.length && (
        <div className="rounded-xl border border-dashed border-edge3 bg-white px-5 py-7 text-[13px] text-mute">
          Nobody is credited with a client yet. Clients that arrive from WabMeta carry the onboarder who brought them in;
          clients added here can be pointed at somebody from the client&apos;s own page.
        </div>
      )}

      {!!unowned && !!rows.length && (
        <p className="mt-3 text-xs text-mute">
          {unowned} client{unowned === 1 ? "" : "s"} {unowned === 1 ? "is" : "are"} credited to nobody, so{" "}
          {unowned === 1 ? "its" : "their"} money is not counted above.
        </p>
      )}
    </>
  );
}

function Payroll() {
  const ops = useOps();
  const { w, m } = ops;
  const wide = useWide();
  const [ym, setYm] = useState(m.thisMonth);
  if (!m.payV) {
    return <LockNotice>You don&apos;t have access to payroll. Salaries and partner draws need Payroll access, set on the Access screen.</LockNotice>;
  }
  const canEdit = m.payE && !m.previewing;
  const lastDay = `${ym}-31`;
  const staff = m.team.filter((p) => p.onPayroll && p.salary != null && (!p.start || p.start <= lastDay) && p.status !== "Exited");
  const rows = staff.map((p) => {
    const e = w.ledger.find((x) => x.category === "Salaries" && x.memberId === p.id && x.date.startsWith(ym));
    const paid = e?.status === "paid";
    const pend = e?.status === "pending";
    return { p, e, paid, pend, amt: e ? e.amount : (p.salary ?? 0) };
  });
  const total = rows.reduce((a, r) => a + r.amt, 0);
  const paidRows = rows.filter((r) => r.paid);
  const paidAmt = paidRows.reduce((a, r) => a + r.amt, 0);
  const out = total - paidAmt;
  const draws = w.ledger.filter((e) => e.category === "Partner draw" && e.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date));
  const cols = wide ? "minmax(0,2fr) 90px 110px 80px 90px minmax(200px,auto)" : "1fr 1fr";
  const payTo = (p: (typeof staff)[number]) =>
    !p.pay ? "No bank or UPI details" : p.pay.method === "upi" ? `UPI · ${p.pay.upi || "not set"}` : `${p.pay.bank || "Bank"} · ••••${p.pay.account.slice(-4)}${p.pay.ifsc ? ` · ${p.pay.ifsc}` : ""}`;

  return (
    <>
      <MonthNav label={ymLabel(ym)} prev={() => setYm(ymAdd(ym, -1))} next={() => setYm(ymAdd(ym, 1))} today={() => setYm(m.thisMonth)} todayLabel="This month">
        {canEdit && paidRows.length < rows.length && (
          <button
            type="button"
            onClick={() => ops.run(payAllSalaries({ ym, memberIds: rows.filter((r) => !r.paid).map((r) => r.p.id) }))}
            className="fw-s h-9 rounded-lg border-0 bg-accent px-4 text-xs text-white hover:bg-accent-h"
          >
            Mark all as paid
          </button>
        )}
      </MonthNav>
      <CardGrid>
        <StatCard label="Payroll this month" value={inr(total)} note={`${rows.length} ${rows.length === 1 ? "employee" : "employees"}`} />
        <StatCard label="Paid" value={inr(paidAmt)} color="#16A34A" note={`${paidRows.length} of ${rows.length} paid`} />
        <StatCard label="Outstanding" value={inr(out)} color={out ? "#D97706" : "#64748B"} note={out ? `${rows.length - paidRows.length} still to pay` : "All paid"} />
      </CardGrid>

      <h3 className="mb-2.5 mt-[22px] text-[15px]">Salaries</h3>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        {wide && (
          <div className="grid gap-3 border-b border-line px-5 py-3 text-[11px] uppercase tracking-[.06em] text-mute" style={{ gridTemplateColumns: cols }}>
            <span>Employee</span>
            <span>Type</span>
            <span>Monthly salary</span>
            <span>Paid on</span>
            <span>Status</span>
            <span />
          </div>
        )}
        {rows.map(({ p, e, paid, pend, amt }) => (
          <div key={p.id} className="grid items-center gap-x-3 gap-y-2 border-b border-line3 px-5 py-[13px] text-[13px]" style={{ gridTemplateColumns: cols }}>
            <button
              type="button"
              onClick={() => ops.setDrawer({ type: "person", id: p.id })}
              className="flex min-w-0 items-center gap-3 border-0 bg-transparent p-0 text-left text-[13px]"
              style={{ gridColumn: wide ? "auto" : "1 / -1" }}
            >
              <span className="fw-s flex size-9 shrink-0 items-center justify-center rounded bg-[rgba(91,91,214,.14)] text-xs text-ink2">{initials(p.name)}</span>
              <span className="min-w-0">
                <span className="fw-s block">{p.name}</span>
                <span className="block text-xs text-mute">
                  {p.title}
                  {p.dept ? ` · ${p.dept}` : ""}
                </span>
                <span className="mt-px block text-[11px]" style={{ color: p.pay ? "#4338CA" : "#B45309" }}>
                  {payTo(p)}
                </span>
              </span>
            </button>
            <span>{p.type}</span>
            <span className="fw-s tnum">{inr(amt)}</span>
            <span className="text-mute2">{paid && e ? dLabel(e.date) : "—"}</span>
            <span>
              <span
                className="fw-s rounded-full px-2.5 py-[3px] text-[11px]"
                style={{ background: paid ? "#DCFCE7" : pend ? "#FEF3C7" : "#F1F5F9", color: paid ? "#15803D" : pend ? "#B45309" : "#475569" }}
              >
                {paid ? "Paid" : pend ? "Pending" : "Not paid"}
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5" style={{ justifyContent: wide ? "flex-end" : "flex-start" }}>
              {canEdit && (
                <>
                  <button type="button" onClick={() => openModal(ops, "salary", { pid: p.id })} className="fw-s h-[30px] rounded-lg border border-edge2 bg-white px-3 text-xs">
                    Salary and bank
                  </button>
                  {!paid && (
                    <button
                      type="button"
                      onClick={() => ops.run(paySalary({ memberId: p.id, ym }))}
                      className="fw-s h-[30px] rounded-lg border-0 bg-accent px-3 text-xs text-white hover:bg-accent-h"
                    >
                      Mark paid
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
        ))}
        {!rows.length && <div className="px-5 py-6 text-[13px] text-mute">No one on payroll for {ymLabel(ym)}.</div>}
      </div>
      <p className="mx-0.5 mb-0 mt-2.5 text-xs text-mute">
        Marking a salary as paid adds it to Income and expenses under Salaries. Salary changes are kept in each person&apos;s salary history and the audit trail.
      </p>

      <Commissions ym={ym} canEdit={canEdit} />

      <div className="mb-2.5 mt-7 flex flex-wrap items-center gap-2">
        <h3 className="m-0 flex-1 text-[15px]">Partner draws</h3>
        {canEdit && m.owners.length > 0 && (
          <button type="button" onClick={() => openModal(ops, "draw")} className="fw-s h-[34px] rounded-lg border-0 bg-accent px-4 text-xs text-white hover:bg-accent-h">
            + Record draw
          </button>
        )}
      </div>
      <p className="m-0 mb-3 max-w-[72ch] text-xs text-mute">
        Profit the owners take out when a client pays. Each draw can be linked to the client payment it came from.
      </p>
      <CardGrid>
        <StatCard
          label="Client payments received"
          value={inr(w.ledger.filter((e) => e.type === "in" && e.status === "paid" && e.date.startsWith(ym)).reduce((a, e) => a + e.amount, 0))}
          color="#16A34A"
          note={`In ${ymLabel(ym)}`}
        />
        {m.owners.map((p) => {
          const ds = w.ledger.filter((e) => e.category === "Partner draw" && e.partnerId === p.id);
          const mon = ds.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + e.amount, 0);
          const year = ds.filter((e) => e.date.startsWith(ym.slice(0, 4))).reduce((a, e) => a + e.amount, 0);
          return <StatCard key={p.id} label={`${p.name} drew`} value={inr(mon)} note={`${inr(year)} so far in ${ym.slice(0, 4)}`} />;
        })}
      </CardGrid>
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
        {draws.map((e) => {
          const p = m.P(e.partnerId);
          const src = e.sourceId ? w.ledger.find((x) => x.id === e.sourceId) : null;
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line3 px-5 py-[13px] text-[13px]">
              <span className="fw-s flex size-9 shrink-0 items-center justify-center rounded bg-ink2 text-xs text-white">{initials(p.name)}</span>
              <span className="min-w-0 flex-[1_1_220px]">
                <span className="fw-s block">{p.name}</span>
                <span className="text-xs text-mute">
                  {dLabel(e.date)} · {src ? `From ${src.desc}` : "Not linked to a payment"}
                </span>
                {e.note && <span className="mt-0.5 block text-xs text-mute2">{e.note}</span>}
              </span>
              <span className="fw-s tnum text-bad">−{inr(e.amount)}</span>
              {canEdit && (
                <button
                  type="button"
                  aria-label="Delete draw"
                  onClick={() => openModal(ops, "deleteDraw", { id: e.id, partner: p.name, amount: e.amount })}
                  className="size-[30px] rounded-md border border-line2 bg-white text-[15px] leading-none text-mute"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {!draws.length && <div className="px-5 py-6 text-[13px] text-mute">No partner draws in {ymLabel(ym)}.</div>}
      </div>
    </>
  );
}
