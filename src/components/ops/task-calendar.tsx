"use client";

import { daysInMonth, iso, utc } from "@/lib/format";
import { DOT } from "@/lib/labels";
import type { TaskW } from "@/lib/types";
import { useOps, useWide } from "./store";

/**
 * A month of work: one cell per day, carrying the tasks due that day, the
 * public holidays and who is on leave.
 *
 * It takes the tasks it should show rather than filtering for itself, so the
 * Dashboard can give it its own filters and the Tasks screen can give it the
 * list the page is already filtered down to. Clicking a day opens the day
 * drawer, which is where the detail lives.
 */
export function MonthGrid({ tasks, ym, selected, onPick }: { tasks: TaskW[]; ym: string; selected: string | null; onPick?: (day: string) => void }) {
  const ops = useOps();
  const { w, m } = ops;
  const wide = useWide();

  const [y, mo] = ym.split("-").map(Number) as [number, number];
  const lead = (utc(`${ym}-01`).getUTCDay() + 6) % 7;
  const dim = daysInMonth(ym);
  const approved = w.leaves.filter((l) => l.status === "approved");
  const cells: ({ day: string; n: number } | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => ({ day: iso(y, mo, i + 1), n: i + 1 })),
  ];
  while (cells.length % 7) cells.push(null);

  function pick(day: string) {
    onPick?.(day);
    ops.setDrawer({ type: "day", day });
  }

  return (
    <>
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
          const ts = tasks.filter((t) => t.due === c.day);
          const hol = m.holidays.get(c.day);
          const onLeave = approved.filter((l) => l.from <= c.day && l.to >= c.day).map((l) => m.P(l.memberId).name.split(" ")[0]);
          const label = hol || (onLeave.length ? `${onLeave.join(", ")} on leave` : "");
          const isLate = ts.some((t) => m.stOf(t) === "late");
          const isSel = selected === c.day;
          const isToday = c.day === m.today;
          return (
            <button
              key={c.day}
              type="button"
              onClick={() => pick(c.day)}
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
    </>
  );
}
