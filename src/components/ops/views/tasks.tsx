"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, dLabel, fmtTsShort, ymAdd, ymLabel } from "@/lib/format";
import { DOT, PRI, SCHIP, STATUS, type DisplayStatus } from "@/lib/labels";
import { nextLabel, nextOccurrence, ruleShort, ruleText } from "@/lib/recurrence";
import type { TaskW } from "@/lib/types";
import {
  addSheetColumn,
  addSheetRow,
  removeSheetColumn,
  removeTaskDept,
  renameSheetColumn,
  setTaskCell,
  toggleSeries,
  toggleVerify,
} from "@/app/(app)/actions/tasks";
import { ADD, openModal } from "../modals";
import { openTask } from "../overlays";
import { MonthGrid } from "../task-calendar";
import { useOps, useWide } from "../store";
import { MonthNav } from "../ui";

type Mode = "table" | "board" | "sheet" | "calendar";

export function TasksView() {
  const ops = useOps();
  const { w, m } = ops;
  const wide = useWide();
  const [q, setQ] = useState("");
  const [who, setWho] = useState("all");
  const [status, setStatus] = useState<"all" | DisplayStatus>("all");
  const [pri, setPri] = useState("all");
  const [brand, setBrand] = useState("all");
  const [dept, setDept] = useState("all");
  const [mode, setMode] = useState<Mode>("table");
  const [ym, setYm] = useState(m.thisMonth);
  const [allTime, setAllTime] = useState(false);
  const [asc, setAsc] = useState(false);
  const [showRec, setShowRec] = useState(false);
  const canEdit = m.edits("tasks") && !m.previewing;

  const ql = q.trim().toLowerCase();
  const matching = w.tasks
    .filter(
      (t) =>
        (who === "all" || t.whoId === who) &&
        (status === "all" || (status === "late" ? m.stOf(t) === "late" : t.status === status)) &&
        (pri === "all" || t.pri === pri) &&
        (brand === "all" || t.brandId === brand) &&
        (dept === "all" || t.deptId === dept) &&
        (!ql || t.title.toLowerCase().includes(ql) || m.tagOf(t).toLowerCase().includes(ql)),
    )
    .sort((a, b) => {
      const r = a.created.localeCompare(b.created) || (a.due ?? "").localeCompare(b.due ?? "");
      return asc ? r : -r;
    });

  // The calendar lays a month out itself, so it takes everything and shows
  // what lands on its days; the other views are narrowed to the month here.
  const byMonth = mode !== "calendar" && !allTime;
  const list = byMonth ? matching.filter((t) => t.due?.startsWith(ym)) : matching;
  const undated = byMonth ? matching.filter((t) => !t.due).length : 0;
  const lateN = list.filter((t) => m.lateDays(t) > 0).length;
  const series = w.series.filter((s) => !s.clientId || m.visIds.has(s.clientId));

  const addDept = () => ops.setQuick({ kind: "tdept", target: "none", field: "dept", form: { name: "" }, error: "", busy: false });
  const sel = "h-[38px] min-w-0 rounded-lg border border-edge2 bg-white px-2.5 text-xs";
  const modeBtn = (id: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      className="fw-s whitespace-nowrap rounded-md border-0 px-3 text-xs"
      style={{ background: mode === id ? "#fff" : "transparent", color: mode === id ? "#0F172A" : "#64748B" }}
    >
      {label}
    </button>
  );

  return (
    <>
      <MonthNav
        bordered="edge"
        label={byMonth || mode === "calendar" ? ymLabel(ym) : "All time"}
        prev={() => {
          if (!allTime) setYm(ymAdd(ym, -1));
          setAllTime(false);
        }}
        next={() => {
          if (!allTime) setYm(ymAdd(ym, 1));
          setAllTime(false);
        }}
        today={() => {
          setYm(m.thisMonth);
          setAllTime(false);
        }}
        todayLabel="This month"
      >
        {mode !== "calendar" && (
          <button
            type="button"
            onClick={() => setAllTime((v) => !v)}
            className="fw-s h-9 rounded-lg border border-edge2 px-3.5 text-xs"
            style={{ background: allTime ? "#111827" : "#fff", color: allTime ? "#fff" : "#0F172A" }}
          >
            All time
          </button>
        )}
      </MonthNav>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks..." className="h-[38px] flex-[1_1_240px] rounded-lg border border-edge2 bg-white px-3.5 text-[13px]" />
        <select value={who} onChange={(e) => setWho(e.target.value)} className={sel}>
          <option value="all">All assignees</option>
          {m.team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={sel}>
          <option value="all">All statuses</option>
          <option value="todo">Not started</option>
          <option value="doing">In progress</option>
          <option value="review">Review</option>
          <option value="blocked">Blocked</option>
          <option value="done">Completed</option>
          <option value="late">Late</option>
        </select>
        <select value={pri} onChange={(e) => setPri(e.target.value)} className={sel}>
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={sel}>
          <option value="all">All brands</option>
          {w.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={dept}
          onChange={(e) => {
            if (e.target.value === ADD) return addDept();
            setDept(e.target.value);
          }}
          className={sel}
        >
          <option value="all">All departments</option>
          {m.deptsForMe.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          {canEdit && <option value={ADD}>+ Add department</option>}
        </select>
        <div className="box-border flex h-[38px] gap-0.5 rounded-lg bg-tint2 p-[3px]">
          {modeBtn("table", "List")}
          {modeBtn("board", "Department board")}
          {modeBtn("sheet", "Sheet")}
          {modeBtn("calendar", "Calendar")}
        </div>
        <button
          type="button"
          onClick={() => setShowRec((v) => !v)}
          className="fw-s h-[38px] whitespace-nowrap rounded-lg border px-3.5 text-xs text-ink"
          style={{ background: showRec ? "#EEF0FF" : "#fff", borderColor: showRec ? "#A5A6F6" : "#E2E8F0" }}
        >
          ↻ Recurring {series.filter((s) => s.active).length}
        </button>
        {canEdit && (
          <button type="button" onClick={() => openModal(ops, "task")} className="fw-s h-[38px] rounded-lg border-0 bg-accent px-4 text-xs text-white hover:bg-accent-h">
            + Add task
          </button>
        )}
      </div>

      {showRec && (
        <div className="mb-3 overflow-hidden rounded-xl border border-edge bg-white">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-tint2 px-4 py-3">
            <span className="fw-s flex-1 text-sm">Recurring tasks</span>
            <span className="text-xs text-mute">A new task is added automatically on each day it repeats.</span>
          </div>
          {series.map((s) => {
            const next = s.active ? nextOccurrence(s.rule, addDays(m.today, 1)) : null;
            const may = !m.previewing && (m.teamAdmin || s.whoId === m.me.id || s.byId === m.me.id);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-tint2 px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-[1_1_260px]">
                  <span className="fw-s block">{s.title}</span>
                  <span className="text-xs text-mute">
                    {m.tagOf(s)} · {m.P(s.whoId).name}
                  </span>
                </span>
                <span className="flex-[0_1_240px] text-xs text-ink3">↻ {ruleText(s.rule)}</span>
                <span className="flex-[0_0_130px] text-xs text-mute">{s.active ? nextLabel(next) : "—"}</span>
                <span
                  className="fw-s rounded-full px-[9px] py-[3px] text-[11px]"
                  style={{ background: s.active ? "#DCFCE7" : "#F1F5F9", color: s.active ? "#15803D" : "#475569" }}
                >
                  {s.active ? "Active" : "Stopped"}
                </span>
                {may && (
                  <button type="button" onClick={() => ops.run(toggleSeries(s.id))} className="fw-s h-[30px] rounded-lg border border-edge2 bg-white px-3 text-xs">
                    {s.active ? "Stop" : "Resume"}
                  </button>
                )}
              </div>
            );
          })}
          {!series.length && <div className="px-4 py-5 text-[13px] text-mute">No recurring tasks yet. In New task, choose how often it repeats.</div>}
        </div>
      )}

      {mode === "table" && <TaskList list={list} wide={wide} asc={asc} toggleSort={() => setAsc((v) => !v)} lateN={lateN} undated={undated} />}
      {mode === "sheet" && <Sheet list={list} />}
      {mode === "board" && (
        <Board list={list} status={status} deptFilter={dept} onAddDept={canEdit ? addDept : undefined} />
      )}
      {mode === "calendar" && <CalendarMode list={list} ym={ym} />}
    </>
  );
}

/** The same month grid the dashboard shows, over whatever the filters leave. */
function CalendarMode({ list, ym }: { list: TaskW[]; ym: string }) {
  const { m } = useOps();
  const [sel, setSel] = useState(m.today);
  const inMonth = list.filter((t) => t.due?.startsWith(ym));
  const noDate = list.filter((t) => !t.due).length;

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <MonthGrid tasks={inMonth} ym={ym} selected={sel} onPick={setSel} />
      <p className="mx-0.5 mb-0 mt-2.5 text-xs text-mute">
        {inMonth.length} {inMonth.length === 1 ? "task" : "tasks"} due in {ymLabel(ym)}
        {noDate ? ` · ${noDate} with no due date` : ""}. Click a day to see everything on it; the filters above apply here too.
      </p>
    </div>
  );
}

const LIST_COLS = "84px minmax(0,2.4fr) minmax(0,.8fr) minmax(0,.7fr) minmax(0,1.5fr) minmax(0,.9fr) 64px 40px minmax(0,1fr) 84px 60px 84px 72px";

function TaskList({ list, wide, asc, toggleSort, lateN, undated }: { list: TaskW[]; wide: boolean; asc: boolean; toggleSort: () => void; lateN: number; undated: number }) {
  const ops = useOps();
  const { w, m } = ops;
  const canVerify = m.teamAdmin && !m.previewing;

  const rowData = (t: TaskW) => {
    const st = m.stOf(t);
    const ld = m.lateDays(t);
    const done = t.status === "done";
    const series = t.seriesId ? w.series.find((s) => s.id === t.seriesId) : null;
    const doc = [...t.notes].reverse().find((n) => n.link);
    const last = t.hist[t.hist.length - 1];
    const lateWord = ld ? `${ld} ${ld === 1 ? "day" : "days"}` : "—";
    const dept = m.D(t.deptId);
    return { st, ld, done, series, doc, last, lateWord, dept };
  };

  if (!wide) {
    return (
      <>
        <div className="flex flex-col gap-2">
          {list.map((t) => {
            const r = rowData(t);
            const pr = PRI[t.pri];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => openTask(ops, t.id)}
                className="flex w-full flex-col gap-2 rounded-[10px] border border-edge px-3.5 py-3 text-left text-[13px]"
                style={{ background: r.st === "late" ? "#FEF2F2" : "#fff" }}
              >
                <span className="fw-s leading-[1.35]">{t.title || "Untitled task"}</span>
                <span className="flex flex-wrap gap-1.5">
                  <span className="fw-s rounded-full bg-accent-s px-[9px] py-[3px] text-[11px] text-indigo">{m.tagOf(t)}</span>
                  <span className="fw-s rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: pr[1], color: pr[2] }}>
                    {pr[0]}
                  </span>
                  <span className="fw-s rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: SCHIP[r.st][0], color: SCHIP[r.st][1] }}>
                    {DOT[r.st].label}
                  </span>
                </span>
                <span className="text-xs text-mute">
                  {m.P(t.whoId).name.split(" ")[0]} · due {t.due ?? "—"} · {r.ld ? `${r.lateWord} late${r.done ? ", submitted" : ""}` : "on time"}
                </span>
              </button>
            );
          })}
        </div>
        {!list.length && <EmptyTasks />}
        <p className="mx-0.5 mb-0 mt-2.5 text-xs text-mute">
          {list.length} {list.length === 1 ? "task" : "tasks"} · {lateN} late
          {undated ? ` · ${undated} with no due date, hidden by the month — use All time` : ""}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-edge bg-white">
        <div className="min-w-[1180px]">
          <div
            className="fw-s grid items-center gap-2.5 border-b border-edge bg-tint px-4 py-[11px] text-[10px] uppercase tracking-[.08em] text-mute"
            style={{ gridTemplateColumns: LIST_COLS }}
          >
            <button type="button" onClick={toggleSort} className="border-0 bg-transparent p-0 text-left uppercase" style={{ font: "inherit", letterSpacing: "inherit", color: "inherit" }}>
              {asc ? "Date ↑" : "Date ↓"}
            </button>
            <span>Task</span>
            <span>Assignee</span>
            <span>By</span>
            <span>Brand · Client</span>
            <span>Department</span>
            <span>Pri</span>
            <span>Est</span>
            <span>Status</span>
            <span>Due</span>
            <span>Late</span>
            <span>Verified</span>
            <span>Notes</span>
          </div>
          {list.map((t) => {
            const r = rowData(t);
            const pr = PRI[t.pri];
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => openTask(ops, t.id)}
                onKeyDown={(e) => e.key === "Enter" && openTask(ops, t.id)}
                className="grid cursor-pointer items-center gap-2.5 border-b border-tint2 px-4 py-[13px] text-[13px]"
                style={{ gridTemplateColumns: LIST_COLS, background: r.st === "late" ? "#FEF2F2" : "#fff" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = r.st === "late" ? "#FDE8E8" : "#F8FAFC")}
                onMouseLeave={(e) => (e.currentTarget.style.background = r.st === "late" ? "#FEF2F2" : "#fff")}
              >
                <span className="tnum text-ink3">{t.created}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="ellipsis min-w-0 text-ink">{t.title || "Untitled task"}</span>
                  {r.series && (
                    <span title={ruleText(r.series.rule)} className="fw-s shrink-0 whitespace-nowrap rounded-full bg-tint2 px-[7px] py-0.5 text-[10px] text-mute2">
                      ↻ {ruleShort(r.series.rule)}
                    </span>
                  )}
                </span>
                <span>{m.P(t.whoId).name.split(" ")[0]}</span>
                <span className="text-mute2">{m.P(t.byId).name.split(" ")[0]}</span>
                <span className="min-w-0">
                  <span className="fw-s ellipsis inline-block max-w-full rounded-full bg-accent-s px-2.5 py-[3px] text-[11px] text-indigo">{m.tagOf(t)}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-ink3">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: r.dept?.color ?? "#CBD5E1" }} />
                  <span className="ellipsis">{r.dept?.name ?? "—"}</span>
                </span>
                <span>
                  <span className="fw-s rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: pr[1], color: pr[2] }}>
                    {pr[0]}
                  </span>
                </span>
                <span className="text-mute">{t.est ? `${t.est}h` : "—"}</span>
                <span className="flex flex-col items-start gap-[3px]">
                  <span className="fw-s whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: SCHIP[r.st][0], color: SCHIP[r.st][1] }}>
                    {DOT[r.st].label}
                  </span>
                  <span className="tnum whitespace-nowrap text-[10px] text-faint">{r.last ? fmtTsShort(r.last.at) : ""}</span>
                </span>
                <span className="tnum flex flex-col gap-0.5 text-ink3">
                  <span>{t.due ?? "—"}</span>
                  {t.dueTime && <span className="text-[10px] text-faint">{t.dueTime}</span>}
                </span>
                <span className="fw-s" style={{ color: r.ld ? (r.done ? "#B45309" : "#DC2626") : "#94A3B8" }}>
                  {r.lateWord}
                </span>
                <span>
                  {r.done ? (
                    <button
                      type="button"
                      disabled={!canVerify}
                      onClick={(e) => {
                        e.stopPropagation();
                        ops.run(toggleVerify(t.id));
                      }}
                      className="fw-s h-6 whitespace-nowrap rounded-full border px-[9px] text-[11px]"
                      style={{
                        background: t.verified ? "#DCFCE7" : "#fff",
                        color: t.verified ? "#15803D" : "#5B5BD6",
                        borderColor: t.verified ? "transparent" : "#C7C8F5",
                      }}
                    >
                      {t.verified ? "✓ Verified" : "Verify"}
                    </button>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </span>
                <span>
                  {t.notes.length ? (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="text-xs text-mute2">
                        {t.notes.length} {t.notes.length === 1 ? "note" : "notes"}
                      </span>
                      {r.doc && (
                        <a href={r.doc.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="fw-s text-xs text-accent">
                          Link
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {!list.length && <EmptyTasks />}
      <p className="mx-0.5 mb-0 mt-2.5 text-xs text-mute">
        {list.length} {list.length === 1 ? "task" : "tasks"} · {lateN} late
        {undated ? ` · ${undated} with no due date, hidden by the month — use All time` : ""}
      </p>
    </>
  );
}

function EmptyTasks() {
  return <div className="mt-2 rounded-xl border border-dashed border-edge3 bg-white px-5 py-8 text-[13px] text-mute">No tasks match these filters.</div>;
}

// ──────────────────────────────────────────────────────────────── board ───

const ORDER: Record<DisplayStatus, number> = { late: 0, blocked: 1, doing: 2, review: 3, todo: 4, done: 5 };

function Board({ list, status, deptFilter, onAddDept }: { list: TaskW[]; status: string; deptFilter: string; onAddDept?: () => void }) {
  const ops = useOps();
  const { m } = ops;
  const hideDone = status === "all";
  const cols = m.deptsForMe.filter((d) => deptFilter === "all" || d.id === deptFilter);
  return (
    <>
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        {cols.map((d) => {
          const all = list.filter((t) => t.deptId === d.id);
          const vis = hideDone ? all.filter((t) => t.status !== "done") : all;
          const done = all.length - vis.length;
          const cards = [...vis].sort((a, b) => ORDER[m.stOf(a)] - ORDER[m.stOf(b)] || (a.due ?? "").localeCompare(b.due ?? ""));
          return (
            <div key={d.id} className="flex flex-col gap-2 rounded-xl border border-edge bg-tint p-3">
              <div className="flex items-center gap-2 px-1 pb-1.5 pt-0.5">
                <span className="size-2 rounded-full" style={{ background: d.color }} />
                <span className="fw-s flex-1 text-sm">{d.name}</span>
                <span className="text-xs text-mute">
                  {vis.length}
                  {hideDone ? " open" : ""}
                </span>
                {m.isOwner && !m.previewing && (
                  <button
                    type="button"
                    title="Remove department"
                    onClick={() => ops.run(removeTaskDept(d.id))}
                    className="border-0 bg-transparent px-0.5 text-[15px] leading-none text-faint hover:text-ink"
                  >
                    ×
                  </button>
                )}
              </div>
              {cards.map((t) => {
                const ld = m.lateDays(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTask(ops, t.id)}
                    className="flex w-full flex-col gap-2 rounded-[10px] border border-edge bg-white p-3 text-left text-[13px] hover:border-accent-l"
                  >
                    <span className="leading-[1.4] text-ink" style={{ textWrap: "pretty" }}>
                      {t.title || "Untitled task"}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <span className="fw-s rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: SCHIP[t.status][0], color: SCHIP[t.status][1] }}>
                        {DOT[t.status].label}
                      </span>
                      <span className="fw-s ellipsis max-w-full rounded-full bg-accent-s px-[9px] py-[3px] text-[11px] text-indigo">{m.tagOf(t)}</span>
                    </span>
                    <span className="flex justify-between gap-2 text-xs text-mute">
                      <span>
                        {m.P(t.whoId).name.split(" ")[0]} · due {t.due ? dLabel(t.due) : "—"}
                      </span>
                      <span className="fw-s text-bad">{ld && t.status !== "done" ? `${ld}d late` : ""}</span>
                    </span>
                  </button>
                );
              })}
              {!cards.length && <div className="px-2 py-4 text-center text-xs text-faint">No open tasks</div>}
              {hideDone && done > 0 && <div className="p-1 text-xs text-mute">{done} completed</div>}
            </div>
          );
        })}
      </div>
      <div className="mx-0.5 mb-0 mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs text-mute">{hideDone ? "Completed tasks are hidden on the board. Pick Completed in the status filter to see them." : ""}</p>
        {onAddDept && (
          <button type="button" onClick={onAddDept} className="fw-s h-[30px] rounded-full border border-dashed border-[#A5A5EA] bg-white px-3 text-xs text-accent">
            + Add department
          </button>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────── sheet ───

/** A text cell that saves when you leave it, not on every keystroke. */
function TextCell({ value, onCommit, placeholder, type = "text", disabled }: { value: string; onCommit: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  // What is being typed, while the cell is being edited; otherwise the saved value shows.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      type={type}
      min={type === "number" ? 0 : undefined}
      value={draft ?? value}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => {
        cancelled.current = false;
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft != null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cellCls}
    />
  );
}

const cellCls =
  "box-border h-[34px] w-full min-w-0 border-0 border-b border-r border-edge2 bg-transparent px-2 text-[13px] text-ink disabled:text-mute";
const headCls = "fw-s sticky top-0 z-[1] flex h-8 items-center overflow-hidden whitespace-nowrap border-b border-r border-edge3 bg-tint2 px-2 text-[11px] text-mute2";

function Sheet({ list }: { list: TaskW[] }) {
  const ops = useOps();
  const { w, m } = ops;
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1100);
  const canEdit = m.edits("tasks") && !m.previewing;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the columns to the width there is, dropping the least useful first.
  const custom = w.sheetCols;
  let used = 40 + 90 + 100 + 120 + 36 + custom.length * 100;
  const sh: Record<string, boolean> = { dept: true };
  let tMin = 180;
  if (used + tMin + 90 > avail) {
    sh.dept = false;
    tMin = Math.max(120, Math.min(180, avail - used));
  } else used += 90;
  used += tMin;
  for (const [k, px] of [
    ["pri", 80],
    ["tag", 120],
    ["by", 90],
    ["est", 56],
    ["late", 50],
  ] as const) {
    if (used + px <= avail) {
      sh[k] = true;
      used += px;
    }
  }
  const base: [string, string][] = [
    ["#", "40px"],
    ["Task", `minmax(${tMin}px,2.6fr)`],
    ["Assignee", "minmax(90px,1fr)"],
    ...(sh.by ? ([["Assigned by", "minmax(90px,1fr)"]] as [string, string][]) : []),
    ...(sh.tag ? ([["Brand · Client", "minmax(120px,1.3fr)"]] as [string, string][]) : []),
    ...(sh.dept ? ([["Department", "minmax(90px,1fr)"]] as [string, string][]) : []),
    ["Status", "minmax(100px,1fr)"],
    ...(sh.pri ? ([["Priority", "minmax(80px,.8fr)"]] as [string, string][]) : []),
    ["Due", "minmax(120px,1fr)"],
    ...(sh.est ? ([["Est (h)", "minmax(56px,.5fr)"]] as [string, string][]) : []),
    ...(sh.late ? ([["Late", "minmax(50px,.5fr)"]] as [string, string][]) : []),
  ];
  const grid = [...base.map((b) => b[1]), ...custom.map(() => "minmax(100px,1fr)"), "36px"].join(" ");

  /** Shows the change at once, then lets the server's answer replace it. */
  function set(t: TaskW, key: string, value: string) {
    const local: Partial<TaskW> =
      key === "title"
        ? { title: value }
        : key === "who"
          ? { whoId: value }
          : key === "by"
            ? { byId: value }
            : key === "dept"
              ? { deptId: value }
              : key === "status"
                ? { status: value as TaskW["status"] }
                : key === "pri"
                  ? { pri: value as TaskW["pri"] }
                  : key === "due"
                    ? { due: value || null }
                    : key === "est"
                      ? { est: value === "" ? null : Number(value) }
                      : { custom: { ...t.custom, [key.slice(2)]: value } };
    ops.apply({ upsert: { tasks: [{ ...t, ...local }] } });
    ops.run(setTaskCell({ id: t.id, key, value }), { quiet: true }).then((r) => {
      if (!r.ok) {
        ops.apply({ upsert: { tasks: [t] } });
        ops.toast(r.error);
      }
    });
  }

  const selCls = `${cellCls} cursor-pointer`;
  return (
    <>
      <div ref={ref} className="max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-lg border border-edge3 bg-white">
        <div className="grid" style={{ gridTemplateColumns: grid }}>
          {base.map(([name]) => (
            <div key={name} className={headCls}>
              {name}
            </div>
          ))}
          {custom.map((c) => (
            <div key={c.id} className={`${headCls} gap-1 pl-0 pr-1`}>
              <TextCell value={c.name} disabled={!canEdit} onCommit={(v) => ops.run(renameSheetColumn({ id: c.id, name: v }), { quiet: true })} />
              {canEdit && (
                <button type="button" title="Delete column" onClick={() => ops.run(removeSheetColumn(c.id), { quiet: true })} className="border-0 bg-transparent text-sm text-faint">
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            title="Add column"
            disabled={!canEdit}
            onClick={() => ops.run(addSheetColumn(), { quiet: true })}
            className={`${headCls} justify-center border-r-0 text-base text-accent`}
          >
            +
          </button>
        </div>
        {list.map((t, i) => {
          const ro = !canEdit || !m.canTask(t);
          const ld = m.lateDays(t);
          const sc = SCHIP[t.status];
          return (
            <div key={t.id} className="grid hover:bg-tint" style={{ gridTemplateColumns: grid }}>
              <button
                type="button"
                title="Open task"
                onClick={() => openTask(ops, t.id)}
                className="box-border h-[34px] w-full border-0 border-b border-r border-edge2 bg-tint px-2 text-center text-[11px] text-mute"
              >
                {i + 1}
              </button>
              <TextCell value={t.title} placeholder="Task title" disabled={ro} onCommit={(v) => set(t, "title", v)} />
              <select value={t.whoId} disabled={ro} onChange={(e) => set(t, "who", e.target.value)} className={selCls}>
                {m.team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {sh.by && (
                <select value={t.byId} disabled={ro} onChange={(e) => set(t, "by", e.target.value)} className={selCls}>
                  {m.team.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              {sh.tag && <div className={`${cellCls} ellipsis flex items-center text-xs text-indigo`}>{m.tagOf(t)}</div>}
              {sh.dept && (
                <select value={t.deptId} disabled={ro} onChange={(e) => set(t, "dept", e.target.value)} className={selCls}>
                  {w.depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={t.status}
                disabled={ro}
                onChange={(e) => set(t, "status", e.target.value)}
                className={`${selCls} fw-s text-xs`}
                style={{ background: sc[0], color: sc[1] }}
              >
                {STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {sh.pri && (
                <select value={t.pri} disabled={ro} onChange={(e) => set(t, "pri", e.target.value)} className={selCls}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              )}
              <input type="date" value={t.due ?? ""} disabled={ro} onChange={(e) => set(t, "due", e.target.value)} className={cellCls} />
              {sh.est && <TextCell type="number" value={t.est != null ? String(t.est) : ""} disabled={ro} onCommit={(v) => set(t, "est", v)} />}
              {sh.late && <div className={`${cellCls} fw-s flex items-center text-xs text-bad`}>{ld ? `${ld}d` : ""}</div>}
              {custom.map((c) => (
                <TextCell key={c.id} value={t.custom[c.id] ?? ""} disabled={ro} onCommit={(v) => set(t, `c:${c.id}`, v)} />
              ))}
              <div className="border-b border-edge2" />
            </div>
          );
        })}
        {canEdit && (
          <button
            type="button"
            onClick={() => ops.run(addSheetRow(), { quiet: true })}
            className="fw-s block h-[34px] w-full border-0 bg-white px-3.5 text-left text-[13px] text-accent hover:bg-tint"
          >
            + New row
          </button>
        )}
      </div>
      <p className="mx-0.5 mb-0 mt-2.5 text-xs text-mute">
        Edit any cell directly. Changes save when you leave the cell. Click a row number to open the full task. Use + in the header to add a column.
      </p>
    </>
  );
}
