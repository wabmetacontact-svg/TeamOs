"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MNF, daysInMonth, inr, inrShort, iso, utc, ymAdd, ymLabel } from "@/lib/format";
import { DOT, type DisplayStatus } from "@/lib/labels";
import { useOps, useWide } from "../store";
import { MonthNav, Section, TextLink } from "../ui";

export function DashboardView() {
  const ops = useOps();
  const { w, m } = ops;
  const router = useRouter();
  const wide = useWide();
  const showFigures = m.fa("dashcards") !== "none";

  // ── figures
  const last3 = [ymAdd(m.thisMonth, -2), ymAdd(m.thisMonth, -1), m.thisMonth];
  const inLast3 = (d: string) => last3.some((k) => d.startsWith(k));
  const clientSpend = w.ledger.filter((e) => e.type === "out" && e.clientId && inLast3(e.date)).reduce((a, e) => a + e.amount, 0);
  const stats = new Map(m.fin.map((c) => [c.id, m.stats(c)]));
  const unprofitable = m.fin.filter((c) => (stats.get(c.id)?.margin ?? 0) < 0);
  const open = w.tasks.filter((t) => t.status !== "done");
  const late = w.tasks.filter((t) => m.stOf(t) === "late");
  const range = `${MNF[Number(last3[0]!.slice(5)) - 1]} to ${MNF[Number(last3[2]!.slice(5)) - 1]}`;
  const kpis = [
    { label: `Client spend, ${range}`, value: inrShort(clientSpend), note: `Across ${m.fin.length} clients with finance access` },
    {
      label: "Clients visible to you",
      value: String(m.vis.length),
      note: m.isOwner ? "Owners see everything" : "Set by your grants",
    },
    { label: "Open tasks", value: String(open.length), note: `${late.length} late` },
    { label: "Unprofitable this month", value: String(unprofitable.length), note: unprofitable.map((c) => c.name).join(", ") || "None" },
  ];

  const spend = w.brands.map((b) => ({
    b,
    v: w.ledger
      .filter((e) => e.type === "out" && e.clientId && inLast3(e.date) && m.C(e.clientId)?.brandId === b.id)
      .reduce((a, e) => a + e.amount, 0),
  }));
  const spendMax = Math.max(1, ...spend.map((x) => x.v));
  const margins = m.fin
    .map((c) => ({ c, mg: stats.get(c.id)?.margin ?? 0 }))
    .sort((a, b) => a.mg - b.mg)
    .slice(0, 5);

  return (
    <>
      {showFigures && (
        <div className="mb-2.5 grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
          {kpis.map((k) => (
            <div key={k.label} className="min-w-0 rounded-lg border border-line bg-white px-3.5 py-2.5">
              <div className="ellipsis text-[11px] text-mute">{k.label}</div>
              <div className="fw-s tnum mt-0.5 text-lg leading-[1.2] tracking-[-.01em] text-ink2">{k.value}</div>
              <div className="ellipsis text-[11px] text-mute">{k.note}</div>
            </div>
          ))}
        </div>
      )}

      <Calendar wide={wide} />

      <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))" }}>
        {showFigures && (
          <>
            <Section>
              <h2 className="m-0 mb-1 text-[15px]">Spend by brand</h2>
              <p className="m-0 mb-[18px] text-xs text-mute">{range}, clients with finance access</p>
              <div className="flex flex-col gap-3.5">
                {spend.map(({ b, v }) => (
                  <div key={b.id} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-[13px]">
                      <span className="fw-s">{b.name}</span>
                      <span>{inr(v)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-sm bg-[rgba(91,91,214,.1)]">
                      <div className="h-full bg-accent transition-[width] duration-[360ms]" style={{ width: `${(v / spendMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {!spend.length && <p className="m-0 text-[13px] text-mute">No brands yet.</p>}
              </div>
            </Section>
            <Section>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="m-0 text-[15px]">Lowest margin this month</h2>
                <TextLink onClick={() => router.push("/clients")}>All clients</TextLink>
              </div>
              {margins.map(({ c, mg }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/clients/${c.id}`)}
                  className="flex w-full items-center gap-3 border-0 border-t border-[rgba(100,116,139,.15)] bg-transparent py-2.5 text-left text-[13px]"
                >
                  <span className="fw-s flex-1">{c.name}</span>
                  {mg < 0 && <span className="fw-s rounded-full bg-bad-s px-2 py-0.5 text-[11px] text-bad-d">Loss</span>}
                  <span className="fw-s min-w-20 text-right" style={{ color: mg < 0 ? "#DC2626" : "#16A34A" }}>
                    {inr(mg)}
                  </span>
                </button>
              ))}
              {!margins.length && <p className="m-0 text-[13px] text-mute">No finance access on any client.</p>}
            </Section>
          </>
        )}
        <Section>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="m-0 text-[15px]">Recent changes</h2>
            {m.sees("audit") && <TextLink onClick={() => router.push("/audit")}>Audit trail</TextLink>}
          </div>
          {w.audit.slice(0, 5).map((a) => (
            <div key={a.id} className="border-t border-[rgba(100,116,139,.15)] py-2.5 text-[13px] leading-[1.45]">
              <div>
                <strong>{a.who}</strong> {a.text}
              </div>
              <div className="text-xs text-mute">
                {a.target} · {atLabel(a.at, m.today)}
              </div>
            </div>
          ))}
          {!w.audit.length && <p className="m-0 text-[13px] text-mute">Nothing recorded yet.</p>}
        </Section>
      </div>
    </>
  );
}

/** "Today, 14:05" or "29 Sep, 14:05". */
export function atLabel(at: string, today: string): string {
  if (at.startsWith(today)) return `Today, ${at.slice(11, 16)}`;
  const d = utc(at.slice(0, 10));
  return `${d.getUTCDate()} ${MNF[d.getUTCMonth()]!.slice(0, 3)}${at.slice(0, 4) === today.slice(0, 4) ? "" : ` ${at.slice(0, 4)}`}, ${at.slice(11, 16)}`;
}

function Calendar({ wide }: { wide: boolean }) {
  const ops = useOps();
  const { w, m } = ops;
  const [ym, setYm] = useState(m.thisMonth);
  const [who, setWho] = useState("all");
  const [brand, setBrand] = useState("all");
  const [status, setStatus] = useState<"all" | DisplayStatus>("all");
  const [sel, setSel] = useState(m.today);

  const base = w.tasks.filter((t) => t.due?.startsWith(ym) && (who === "all" || t.whoId === who) && (brand === "all" || t.brandId === brand));
  const count = (k: DisplayStatus) => base.filter((t) => m.stOf(t) === k).length;
  const shown = status === "all" ? base : base.filter((t) => m.stOf(t) === status);
  const stats: ["all" | DisplayStatus, string, number, string][] = [
    ["all", "Total", base.length, "#5B5BD6"],
    ["todo", "Not started", count("todo"), "#64748B"],
    ["doing", "In progress", count("doing"), "#2563EB"],
    ["review", "Review", count("review"), "#D97706"],
    ["blocked", "Blocked", count("blocked"), "#0F172A"],
    ["done", "Completed", count("done"), "#16A34A"],
    ["late", "Late", count("late"), "#DC2626"],
  ];

  const [y, mo] = ym.split("-").map(Number) as [number, number];
  const lead = (utc(`${ym}-01`).getUTCDay() + 6) % 7;
  const dim = daysInMonth(ym);
  const approved = w.leaves.filter((l) => l.status === "approved");
  const cells: ({ day: string; n: number } | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: dim }, (_, i) => ({ day: iso(y, mo, i + 1), n: i + 1 }))];
  while (cells.length % 7) cells.push(null);

  const sel0 = "h-9 rounded-lg border border-line2 bg-white px-2.5 text-xs";

  return (
    <Section className="p-4">
      <div className="mb-3.5 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))" }}>
        {stats.map(([id, label, value, color]) => {
          const active = status === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setStatus(id)}
              className="rounded-lg border px-2 py-2.5 text-center"
              style={{ borderColor: active ? "#5B5BD6" : "transparent", background: active ? "rgba(91,91,214,.1)" : "rgba(100,116,139,.05)" }}
            >
              <div className="fw-s text-xl" style={{ color }}>
                {value}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-mute">{label}</div>
            </button>
          );
        })}
      </div>

      <MonthNav
        big={false}
        label={ymLabel(ym)}
        prev={() => setYm(ymAdd(ym, -1))}
        next={() => setYm(ymAdd(ym, 1))}
        today={() => {
          setYm(m.thisMonth);
          setSel(m.today);
        }}
      >
        <select value={who} onChange={(e) => setWho(e.target.value)} className={sel0}>
          <option value="all">All assignees</option>
          {m.team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={sel0}>
          <option value="all">All brands</option>
          {w.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </MonthNav>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="fw-s bg-[rgba(100,116,139,.06)] px-1 py-2 text-center text-[10px] tracking-[.08em] text-mute">
            {wide ? d.toUpperCase() : d[0]}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={`b${i}`} className="bg-[rgba(100,116,139,.09)]" style={{ minHeight: wide ? 118 : 70 }} />;
          const wd = utc(c.day).getUTCDay();
          const weekend = wd === 0 || wd === 6;
          const ts = shown.filter((t) => t.due === c.day);
          const hol = m.holidays.get(c.day);
          const onLeave = approved.filter((l) => l.from <= c.day && l.to >= c.day).map((l) => m.P(l.memberId).name.split(" ")[0]);
          const label = hol || (onLeave.length ? `${onLeave.join(", ")} on leave` : "");
          const isLate = ts.some((t) => m.stOf(t) === "late");
          const isSel = sel === c.day;
          const isToday = c.day === m.today;
          return (
            <button
              key={c.day}
              type="button"
              onClick={() => {
                setSel(c.day);
                ops.setDrawer({ type: "day", day: c.day });
              }}
              className="flex min-w-0 flex-col gap-1 overflow-hidden border-0 p-1.5 text-left"
              style={{
                minHeight: wide ? 118 : 70,
                background: isSel ? "#EEF0FF" : hol ? "#FFF7ED" : wd === 0 ? "#FEF6F6" : weekend ? "#F8FAFC" : "#fff",
                boxShadow: `inset 0 0 0 2px ${isToday ? "#5B5BD6" : "transparent"}`,
              }}
            >
              <span
                className="text-xs"
                style={{ fontWeight: isToday ? "var(--fw-strong)" : "var(--fw-body)", color: wd === 0 ? "#DC2626" : hol ? "#C2410C" : "#0F172A" }}
              >
                {c.n}
              </span>
              {label && <span className="ellipsis max-w-full text-[9px] leading-[1.2] text-[#C2410C]">{label}</span>}
              <span className="flex flex-wrap gap-[3px]">
                {ts.slice(0, wide ? 10 : 4).map((t) => {
                  const d = DOT[m.stOf(t)];
                  return <span key={t.id} className="size-[7px] rounded-[1px]" style={{ background: d.bg, boxShadow: `inset 0 0 0 1px ${d.edge}` }} />;
                })}
              </span>
              {ts.length > 0 && (
                <span className="fw-s text-[10px]" style={{ color: isLate ? "#DC2626" : "#475569" }}>
                  {ts.length}
                  {wide ? (ts.length === 1 ? " task" : " tasks") : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11px] text-mute">
        {(["todo", "doing", "review", "blocked", "done", "late"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[1px]" style={{ background: DOT[k].bg, boxShadow: `inset 0 0 0 1px ${DOT[k].edge}` }} />
            {DOT[k].label}
          </span>
        ))}
      </div>
    </Section>
  );
}
