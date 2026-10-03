"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLIENT_LEVEL_LABEL } from "@/lib/access";
import { DOW, MNF, dLabel, dLong, fmtCur, fmtTs, inr, ordinal, utc, ymLabel } from "@/lib/format";
import { DOT, HR_STATUSES, SCHIP, STATUS } from "@/lib/labels";
import { ruleText } from "@/lib/recurrence";
import type { Result, TaskW } from "@/lib/types";
import { addBrand, createClient } from "@/app/(app)/actions/clients";
import { addCategory } from "@/app/(app)/actions/ledger";
import { addArea, addNote, addTaskDept, saveTask, toggleSeries } from "@/app/(app)/actions/tasks";
import { addHrDept, createLoginLink, createMember, setMemberStatus, setTaskBoards } from "@/app/(app)/actions/team";
import { Icon } from "./icons";
import { ADD, FormModal, openModal } from "./modals";
import { type Drawer, type QuickKind, useOps } from "./store";

type Ops = ReturnType<typeof useOps>;

export function openTask(ops: Ops, id: string, back?: Drawer | null) {
  const t = ops.w.tasks.find((x) => x.id === id);
  if (!t) return;
  ops.setDraft({
    status: t.status,
    who: t.whoId,
    by: t.byId,
    hours: String(t.hours),
    due: t.due ?? "",
    pri: t.pri,
    est: t.est != null ? String(t.est) : "",
    brand: t.brandId,
    client: t.clientId ?? (t.area ? `@${t.area}` : ""),
    dept: t.deptId,
  });
  ops.setDrawer({ type: "task", id, back: back ?? null });
}

export function Overlays() {
  const ops = useOps();
  return (
    <>
      <DrawerPanel />
      <FormModal />
      <QuickAdd />
      <NoticeModal />
      {ops.toastText && (
        <div
          className="fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100%-32px)] -translate-x-1/2 animate-rise items-center gap-2.5 rounded-full bg-ink2 px-[18px] py-3 text-[13px] text-white shadow-[0_8px_24px_rgba(15,23,42,.2)]"
          style={{ ["--icon-stroke" as string]: "#fff" }}
          role="status"
        >
          <Icon name="check" size={18} />
          <span>{ops.toastText}</span>
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────── drawers ───

const kicker = "text-[10px] uppercase tracking-[.08em] text-mute";
const selectCls = "fw-b h-[42px] min-w-0 rounded-lg border border-edge2 bg-white px-3 text-sm disabled:bg-tint";

function DrawerPanel() {
  const ops = useOps();
  const { drawer, setDrawer, m, w } = ops;
  if (!drawer) return null;

  let head: { kicker: string; title: string } | null = null;
  let body: React.ReactNode = null;
  let foot: React.ReactNode = null;

  if (drawer.type === "task") {
    const t = w.tasks.find((x) => x.id === drawer.id);
    if (t) [head, body, foot] = TaskDrawer({ ops, t, back: drawer.back ?? null });
  }
  if (drawer.type === "person") {
    const p = m.P(drawer.id);
    if (p.id) [head, body] = PersonDrawer({ ops, id: p.id });
  }
  if (drawer.type === "client") {
    const c = m.C(drawer.id);
    if (c && m.visIds.has(c.id)) [head, body, foot] = ClientDrawer({ ops, id: c.id });
  }
  if (drawer.type === "day") [head, body, foot] = DayDrawer({ ops, day: drawer.day });
  if (!head) return null;

  return (
    <>
      <div onClick={() => setDrawer(null)} className="fixed inset-0 z-40 bg-[rgba(15,23,42,.35)]" />
      <aside className="fixed bottom-0 right-0 top-0 z-[41] flex w-[min(460px,100%)] animate-rise flex-col bg-white shadow-[-8px_0_32px_rgba(15,23,42,.15)]">
        <div className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-mute">{head.kicker}</div>
            <h2 className="mt-1 mb-0 text-lg leading-[1.3]">{head.title}</h2>
          </div>
          <button type="button" onClick={() => setDrawer(null)} aria-label="Close" className="size-11 rounded-lg border border-line2 bg-white text-lg">
            ×
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-6 py-5">{body}</div>
        {foot}
      </aside>
    </>
  );
}

function TaskDrawer({ ops, t, back }: { ops: Ops; t: TaskW; back: Drawer | null }): [{ kicker: string; title: string }, React.ReactNode, React.ReactNode] {
  return [{ kicker: `Task · ${ops.m.tagOf(t)}`, title: t.title || "Untitled task" }, <TaskBody key={t.id} ops={ops} t={t} back={back} />, <TaskFoot key="f" ops={ops} t={t} back={back} />];
}

function TaskBody({ ops, t, back }: { ops: Ops; t: TaskW; back: Drawer | null }) {
  const { m, w, draft, setDraft } = ops;
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busyNote, setBusyNote] = useState(false);
  const series = t.seriesId ? w.series.find((s) => s.id === t.seriesId) : null;
  const ro = !m.canTask(t) || m.previewing;
  const ld = m.lateDays(t);
  const db = m.B(draft.brand);
  const agency = db?.kind !== "startup";
  const forOpts = agency
    ? [{ id: "", name: `${db?.name ?? "Brand"} operations` }, ...m.vis.filter((c) => c.brandId === draft.brand).map((c) => ({ id: c.id, name: c.name }))]
    : [{ id: "", name: db?.name ?? "Brand" }, ...(db?.areas ?? []).map((a) => ({ id: `@${a}`, name: a }))];
  const canStop = !!series && !m.previewing && (m.teamAdmin || series.whoId === m.me.id || series.byId === m.me.id);
  const canNote = !m.previewing && (!ro || t.whoId === m.me.id);

  const onDraft = (name: keyof typeof draft, value: string) => {
    if (value === ADD) {
      const kind: QuickKind = name === "dept" ? "tdept" : name === "client" ? "area" : "member";
      return ops.setQuick({ kind, target: "draft", field: name, form: { name: "", brand: draft.brand, role: "", kind: "agency" }, error: "", busy: false });
    }
    setDraft((d) => ({
      ...d,
      [name]: value,
      ...(name === "brand" && d.client && !d.client.startsWith("@") && m.C(d.client)?.brandId !== value ? { client: "" } : {}),
      ...(name === "brand" && d.client.startsWith("@") ? { client: "" } : {}),
    }));
  };

  async function submitNote() {
    if (!note.trim() || busyNote) return;
    setBusyNote(true);
    const r = await ops.run(addNote({ id: t.id, text: note }));
    setBusyNote(false);
    if (r.ok) setNote("");
  }

  const notes = [...t.notes].reverse();
  const hist = [...t.hist].reverse();
  const label = "fw-s flex flex-col gap-2 text-xs";

  return (
    <>
      {back?.type === "day" && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            ops.setDrawer(back);
          }}
          className="fw-s -mb-1.5 text-xs"
        >
          ← Back to {dLabel(back.day)}
        </a>
      )}
      {ro && !m.previewing && (
        <div className="rounded-md bg-[rgba(91,91,214,.08)] px-3 py-2.5 text-xs">You have View access on {m.tgtOf(t)}. Editing is disabled.</div>
      )}
      {series && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-tint2 px-3 py-2.5 text-[13px] text-ink3">
          <span className="min-w-[180px] flex-1">
            ↻ {ruleText(series.rule)}
            {series.active ? "" : " · stopped"}
          </span>
          {canStop && (
            <button
              type="button"
              onClick={() => ops.run(toggleSeries(series.id))}
              className="fw-s h-[30px] rounded-lg border border-edge2 bg-white px-3 text-xs"
            >
              {series.active ? "Stop repeating" : "Resume"}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="fw-s text-xs">Status</span>
        <div className="grid grid-cols-5 gap-1 rounded-lg bg-[rgba(100,116,139,.1)] p-1">
          {STATUS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={ro}
              onClick={() => setDraft((d) => ({ ...d, status: s.id }))}
              className="fw-s h-9 rounded-md border-0 text-xs"
              style={{ background: draft.status === s.id ? "#fff" : "transparent", color: draft.status === s.id ? "#111827" : "#64748B" }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <label className={label}>
        Department
        <select value={draft.dept} disabled={ro} onChange={(e) => onDraft("dept", e.target.value)} className={selectCls}>
          {m.deptsForMe.concat(m.deptsForMe.some((d) => d.id === draft.dept) ? [] : m.D(draft.dept) ? [m.D(draft.dept)!] : []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={ADD}>+ Add department</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Priority
          <select value={draft.pri} disabled={ro} onChange={(e) => onDraft("pri", e.target.value)} className={selectCls}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className={label}>
          Estimate (hours)
          <input
            type="number"
            min="0"
            value={draft.est}
            disabled={ro}
            placeholder="None"
            onChange={(e) => onDraft("est", e.target.value)}
            className={selectCls}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Brand
          <select value={draft.brand} disabled={ro} onChange={(e) => onDraft("brand", e.target.value)} className={selectCls}>
            {w.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Working for
          <select value={draft.client} disabled={ro} onChange={(e) => onDraft("client", e.target.value)} className={selectCls}>
            {forOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {!agency && <option value={ADD}>+ Add area</option>}
          </select>
        </label>
      </div>
      <label className={label}>
        Assignee
        <select value={draft.who} disabled={ro} onChange={(e) => onDraft("who", e.target.value)} className={selectCls}>
          {m.active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {m.edits("team") && <option value={ADD}>+ Add new team member</option>}
        </select>
      </label>
      <label className={label}>
        Assigned by
        <select value={draft.by} disabled={ro} onChange={(e) => onDraft("by", e.target.value)} className={selectCls}>
          {m.team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Due date
        <input type="date" value={draft.due} disabled={ro} onChange={(e) => onDraft("due", e.target.value)} className={selectCls} />
      </label>
      <label className={label}>
        Hours logged
        <input type="number" min="0" value={draft.hours} disabled={ro} onChange={(e) => onDraft("hours", e.target.value)} className={selectCls} />
      </label>
      {ld > 0 && (
        <div className="fw-s text-[13px] text-bad">
          {ld} {ld === 1 ? "day" : "days"} late{t.status === "done" ? `, submitted ${dLabel(m.doneAt(t))}` : `, was due ${dLabel(t.due)}`}
        </div>
      )}
      <div className="text-[13px] leading-[1.6] text-mute">
        Brand {m.brandName(t.brandId)}
        {t.clientId && (
          <>
            {" · Client "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                ops.setDrawer(null);
                router.push(`/clients/${t.clientId}?tab=tasks`);
              }}
            >
              {m.clientName(t.clientId)}
            </a>
          </>
        )}{" "}
        · Created {t.created} by {m.P(t.byId).name}
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="fw-s text-xs">
          Notes <span className="text-faint">{t.notes.length || ""}</span>
        </span>
        {canNote && (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Add a note. Paste a doc link to attach it."
              className="fw-b w-full resize-y rounded-lg border border-edge2 px-3 py-2.5 text-[13px] leading-normal"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!note.trim() || busyNote}
                onClick={submitNote}
                className="fw-s h-[34px] rounded-lg border-0 px-4 text-xs text-white"
                style={{ background: note.trim() && !busyNote ? "#5B5BD6" : "#94A3B8" }}
              >
                {busyNote ? "Adding…" : "Add note"}
              </button>
            </div>
          </>
        )}
        {notes.map((n) => {
          const text = n.link ? n.text.replace(n.link, "").trim() : n.text;
          return (
            <div key={n.id} className="rounded-lg border border-edge bg-tint px-3 py-2.5 text-[13px] leading-normal">
              <div className="mb-1 flex justify-between gap-2 text-[11px] text-mute">
                <span className="fw-s text-ink3">{m.P(n.byId).name}</span>
                <span>{fmtTs(n.at)}</span>
              </div>
              {text && <div className="whitespace-pre-wrap break-words">{text}</div>}
              {n.link && (
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="fw-s mt-1 inline-block break-all text-xs">
                  {n.link.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          );
        })}
        {!notes.length && <p className="m-0 text-xs text-faint">No notes yet.</p>}
      </div>
      <div>
        <span className="fw-s text-xs">Status history</span>
        <div className="mt-2 flex flex-col">
          {hist.map((x, i) => (
            <div key={i} className="flex items-start gap-2.5 border-t border-tint2 py-2 text-xs">
              <span className="mt-1 size-2 shrink-0 rounded-sm" style={{ background: DOT[x.status].bg, boxShadow: `inset 0 0 0 1px ${DOT[x.status].edge}` }} />
              <span className="min-w-0 flex-1">
                <span className="fw-s text-ink">{DOT[x.status].label}</span> <span className="text-mute">by {m.P(x.byId).name}</span>
              </span>
              <span className="tnum whitespace-nowrap text-mute">{fmtTs(x.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TaskFoot({ ops, t, back }: { ops: Ops; t: TaskW; back: Drawer | null }) {
  const [saving, setSaving] = useState(false);
  const ro = !ops.m.canTask(t) || ops.m.previewing;
  async function save() {
    setSaving(true);
    const d = ops.draft;
    const r = await ops.run(
      saveTask({
        id: t.id,
        status: d.status as TaskW["status"],
        who: d.who,
        by: d.by,
        hours: d.hours,
        due: d.due,
        pri: d.pri as TaskW["pri"],
        est: d.est,
        brand: d.brand,
        client: d.client,
        dept: d.dept,
      }),
    );
    setSaving(false);
    if (r.ok) ops.setDrawer(back ?? null);
  }
  return (
    <div className="flex items-center gap-2 border-t border-line px-6 py-4">
      <span className="flex-1 text-xs text-mute">{saving ? "Writing to the database" : "Saved only after the database confirms."}</span>
      <button type="button" onClick={() => ops.setDrawer(null)} className="fw-s h-[42px] rounded-full border border-[rgba(100,116,139,.35)] bg-white px-[18px] text-[13px]">
        Cancel
      </button>
      <button
        type="button"
        disabled={saving || ro}
        onClick={save}
        className="fw-s h-[42px] rounded-full border-0 px-5 text-[13px] text-white"
        style={{ background: saving || ro ? "#64748B" : "#5B5BD6" }}
      >
        {saving ? "Saving" : "Save"}
      </button>
    </div>
  );
}

function PersonDrawer({ ops, id }: { ops: Ops; id: string }): [{ kicker: string; title: string }, React.ReactNode] {
  const p = ops.m.P(id);
  return [{ kicker: `Team · ${p.dept || p.title}`, title: p.name }, <PersonBody key={id} ops={ops} id={id} />];
}

function PersonBody({ ops, id }: { ops: Ops; id: string }) {
  const { m, w } = ops;
  const p = m.P(id);
  const [linkBusy, setLinkBusy] = useState(false);
  const locked = !m.teamAdmin || p.isOwner || p.id === m.me.id || m.previewing;
  const grants = w.clients
    .map((c) => ({ c, l: m.lvl(p.id, c.id) }))
    .filter((x) => x.l !== "none")
    .map((x) => `${x.c.name} · ${CLIENT_LEVEL_LABEL[x.l]}`);
  const open = w.tasks.filter((t) => t.whoId === p.id && t.status !== "done");
  const payTo = !p.pay
    ? "No bank or UPI details"
    : p.pay.method === "upi"
      ? `UPI · ${p.pay.upi || "not set"}`
      : `${p.pay.bank || "Bank"} · ••••${p.pay.account.slice(-4)}${p.pay.ifsc ? ` · ${p.pay.ifsc}` : ""}`;
  const facts: [string, string][] = [
    ["Role", p.title],
    ["Brand", m.brandName(p.brandId)],
    ["Type", p.type],
    ["Joined", p.start ? dLong(p.start) : "—"],
    ["Email", p.email || "Not set"],
    ["Phone", p.phone || "Not set"],
    ["Reports to", p.managerId ? m.P(p.managerId).name : "None"],
    ["Monthly salary", p.onPayroll ? (m.payV && p.salary != null ? inr(p.salary) : "Restricted") : "Not on payroll"],
    ...(m.payV ? ([["Paid via", payTo]] as [string, string][]) : []),
  ];
  const left = p.leaveTotal - p.leaveUsed;
  const leavePct = p.leaveTotal ? `${Math.max(0, (left / p.leaveTotal) * 100)}%` : "0%";
  const boards = [{ id: "__all", name: "All" }, ...w.depts];
  const canLink = m.teamAdmin && !m.previewing && (!p.isOwner || m.me.isOwner) && p.id !== m.me.id;

  async function link() {
    setLinkBusy(true);
    const r = await ops.run(createLoginLink(p.id), { quiet: true });
    setLinkBusy(false);
    if (!r.ok) return ops.toast(r.error);
    const url = (r.data as { link: string }).link;
    ops.setNotice({
      title: p.canLogin ? `New login link for ${p.name}` : `Login link for ${p.name}`,
      text: `${p.name.split(" ")[0]} opens it to ${p.canLogin ? "set a new password" : "set a password"}, then logs in with ${p.email}. It works once and expires in 7 days; any older link stops working. Copy it and send it yourself.`,
      link: url,
    });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        {facts.map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] text-mute">{k}</div>
            <div className="fw-s mt-0.5 break-words">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(m.teamAdmin || m.isOwner) && !m.previewing && (!p.isOwner || m.me.isOwner) && (
          <button
            type="button"
            onClick={() => openModal(ops, "editMember", p as unknown as Record<string, unknown>)}
            className="fw-s h-[34px] rounded-lg border border-edge2 bg-white px-3.5 text-xs hover:bg-tint"
          >
            Edit profile
          </button>
        )}
        {canLink && (
          <button
            type="button"
            disabled={linkBusy || !p.email}
            title={p.email ? undefined : "Add an email first"}
            onClick={link}
            className="fw-s h-[34px] rounded-lg border border-edge2 bg-white px-3.5 text-xs text-accent hover:bg-tint disabled:opacity-60"
          >
            {linkBusy ? "Making link…" : p.canLogin ? "New login link" : "Send login link"}
          </button>
        )}
      </div>
      {!p.canLogin && <p className="m-0 -mt-2 text-xs text-mute">Hasn&apos;t set a password yet, so cannot log in.</p>}
      <label className="fw-s flex flex-col gap-2 text-xs">
        Employment status
        <select
          value={p.status}
          disabled={locked}
          onChange={(e) => ops.run(setMemberStatus({ id: p.id, status: e.target.value }))}
          className="fw-b h-10 rounded-lg border border-line2 bg-white px-3 text-sm disabled:bg-tint"
        >
          {HR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {!p.isOwner && (
        <div className="flex shrink-0 flex-col gap-2">
          <span className="fw-s text-xs">Task boards they can see</span>
          <div className="flex flex-wrap gap-1.5">
            {boards.map((d) => {
              const sel = d.id === "__all" ? !p.taskDeptIds.length : p.taskDeptIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const next = d.id === "__all" ? [] : sel ? p.taskDeptIds.filter((x) => x !== d.id) : [...p.taskDeptIds, d.id];
                    ops.run(setTaskBoards({ id: p.id, deptIds: next }), { quiet: true });
                  }}
                  className="fw-s h-8 rounded-full border px-3 text-xs"
                  style={{ background: sel ? "#5B5BD6" : "#fff", color: sel ? "#fff" : "#0F172A", borderColor: sel ? "#5B5BD6" : "#E2E8F0" }}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-mute">
            {p.taskDeptIds.length ? "Only tasks in these departments, plus tasks assigned to them." : "All departments. Pick one or more to limit what they see."}
          </span>
        </div>
      )}
      <div>
        <div className="fw-s mb-1.5 flex justify-between text-xs">
          <span>Leave balance</span>
          <span>
            {left} of {p.leaveTotal} days left
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-sm bg-[rgba(91,91,214,.12)]">
          <div className="h-full bg-accent" style={{ width: leavePct }} />
        </div>
        {!m.previewing && (p.id === m.me.id || m.teamAdmin) && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openModal(ops, "leave", { who: p.id });
            }}
            className="fw-s mt-2 inline-block text-xs"
          >
            + Add leave request
          </a>
        )}
      </div>
      {m.payV && p.salaryHistory.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="fw-s text-xs">Salary history</span>
            {m.payE && !m.previewing && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openModal(ops, "salary", { pid: p.id });
                }}
                className="fw-s text-xs"
              >
                Edit salary and bank
              </a>
            )}
          </div>
          {[...p.salaryHistory].reverse().map((x, i) => (
            <div key={i} className="flex justify-between gap-2 border-t border-[rgba(100,116,139,.15)] py-[9px] text-[13px]">
              <span className="text-mute2">From {dLong(x.from)}</span>
              <span className="fw-s tnum">{inr(x.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {grants.length > 0 && (
        <div>
          <span className="fw-s text-xs">Client access</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {grants.map((g) => (
              <span key={g} className="rounded-full border border-[rgba(100,116,139,.35)] px-2.5 py-1 text-[11px]">
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
      {open.length > 0 && (
        <div>
          <span className="fw-s text-xs">Open tasks</span>
          {open.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTask(ops, t.id)}
              className="flex w-full justify-between gap-2 border-0 border-b border-line3 bg-transparent py-2.5 text-left text-[13px]"
            >
              <span className="fw-s">{t.title || "Untitled task"}</span>
              <span className="whitespace-nowrap text-xs text-mute">{m.tagOf(t)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ClientDrawer({ ops, id }: { ops: Ops; id: string }): [{ kicker: string; title: string }, React.ReactNode, React.ReactNode] {
  const { m, w } = ops;
  const c = m.C(id)!;
  const f = m.finIds.has(c.id);
  const inc = w.ledger.filter((e) => e.clientId === c.id && e.type === "in").sort((a, b) => b.date.localeCompare(a.date));
  const paid = inc.filter((e) => e.status === "paid");
  const total = paid.reduce((a, e) => a + e.amount, 0);
  const bySvc = new Map<string, { n: number; t: number; last: string }>();
  for (const e of paid) {
    const o = bySvc.get(e.category) ?? { n: 0, t: 0, last: "" };
    o.t += e.amount;
    o.n++;
    if (e.date > o.last) o.last = e.date;
    bySvc.set(e.category, o);
  }
  const rate = !f
    ? "Restricted"
    : c.rates.length
      ? [...c.rates]
          .reverse()
          .map((r) => `${fmtCur(r.amount, r.currency)} per month, ${r.to ? `${ymLabel(r.from.slice(0, 7))} to ${ymLabel(r.to.slice(0, 7))}` : `since ${ymLabel(r.from.slice(0, 7))}`}`)
          .join(" · was ")
      : `${inr(c.retainer ?? 0)} per month · paid in ${c.currency}`;
  const facts: [string, string][] = [
    ["Company", c.company || c.name],
    ["Onboard date", c.sinceDate ? dLong(c.sinceDate) : "—"],
    ["Paid date", c.payDay ? `${ordinal(c.payDay)} of every month` : "Not set"],
    ["Services provided", c.services || "Not set"],
    ["Rate / payment terms", rate],
    ["Main contact", c.contact],
  ];
  const cantEdit = !(m.edits("clients") && m.can(c.id, "edit")) || m.previewing;

  const body = (
    <>
      <div className="flex flex-col gap-3.5">
        {facts.map(([k, v]) => (
          <div key={k}>
            <div className={kicker}>{k}</div>
            <div className="mt-[3px] text-sm text-ink">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={cantEdit}
          onClick={() => openModal(ops, "editClient", { id: c.id })}
          className="fw-s h-[34px] rounded-lg border border-edge2 bg-white px-3.5 text-xs disabled:opacity-60"
        >
          Edit client profile
        </button>
        <Link
          href={`/clients/${c.id}`}
          onClick={() => ops.setDrawer(null)}
          className="fw-s inline-flex h-[34px] items-center rounded-lg border border-edge2 bg-white px-3.5 text-xs text-accent no-underline hover:no-underline"
        >
          Open full client page
        </Link>
      </div>
      <div className="h-px bg-edge" />
      {f ? (
        <>
          <div>
            <div className={kicker}>Total revenue from this client</div>
            <div className="fw-s tnum mt-1 text-[26px] text-good">{inr(total)}</div>
          </div>
          <div>
            <div className={kicker}>Total payments</div>
            <div className="mt-[3px] text-sm">
              {paid.length} {paid.length === 1 ? "payment" : "payments"}
              {inc.length > paid.length ? ` · ${inc.length - paid.length} pending` : ""}
            </div>
          </div>
          <div>
            <div className={`${kicker} mb-2`}>What you earn from this client</div>
            <div className="overflow-hidden rounded-lg border border-edge text-xs">
              <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_60px_60px] gap-2 bg-tint px-2.5 py-2 text-[10px] uppercase tracking-[.06em] text-mute">
                <span>Service</span>
                <span>Total earned</span>
                <span>Payments</span>
                <span>Last paid</span>
              </div>
              {[...bySvc.entries()].map(([k, o]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1.6fr)_1fr_60px_60px] gap-2 border-t border-tint2 px-2.5 py-[9px]">
                  <span className="ellipsis">{k}</span>
                  <span className="fw-s text-good">{inr(o.t)}</span>
                  <span>{o.n}x</span>
                  <span>{dLabel(o.last)}</span>
                </div>
              ))}
              {!bySvc.size && <div className="border-t border-tint2 px-2.5 py-3 text-mute">Nothing received yet.</div>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className={kicker}>Payment history</span>
              {m.edits("expenses") && !m.previewing && (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    openModal(ops, "entry", { type: "in", client: c.id });
                  }}
                  className="fw-s text-xs"
                >
                  + Add payment
                </a>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-edge text-xs">
              <div className="grid grid-cols-[52px_1fr_40px_74px_minmax(0,1.3fr)] gap-2 bg-tint px-2.5 py-2 text-[10px] uppercase tracking-[.06em] text-mute">
                <span>Date</span>
                <span>Amount</span>
                <span>Cur</span>
                <span>Status</span>
                <span>Detail</span>
              </div>
              {inc.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openModal(ops, "editEntry", e as unknown as Record<string, unknown>)}
                  className="grid w-full grid-cols-[52px_1fr_40px_74px_minmax(0,1.3fr)] items-center gap-2 border-0 border-t border-tint2 bg-white px-2.5 py-[9px] text-left text-xs hover:bg-tint"
                >
                  <span>{dLabel(e.date)}</span>
                  <span className="fw-s text-good">+{inr(e.amount)}</span>
                  <span className="text-mute">{e.currency || "INR"}</span>
                  <span>
                    <span
                      className="fw-s rounded px-[7px] py-0.5 text-[10px]"
                      style={{ background: e.status === "paid" ? "#DCFCE7" : "#FEF3C7", color: e.status === "paid" ? "#15803D" : "#B45309" }}
                    >
                      {e.status === "paid" ? "Received" : "Pending"}
                    </span>
                  </span>
                  <span className="ellipsis text-mute2">{(e.currency && e.orig ? `${fmtCur(e.orig, e.currency)} · ` : "") + e.desc}</span>
                </button>
              ))}
              {!inc.length && <div className="border-t border-tint2 px-2.5 py-3 text-mute">No payments recorded yet.</div>}
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-edge3 p-4 text-[13px] text-mute2" style={{ ["--icon-stroke" as string]: "#5B5BD6" }}>
          <Icon name="lock" size={20} />
          Revenue and payments need Finance access on this client.
        </div>
      )}
    </>
  );
  const foot =
    m.isOwner && !m.previewing ? (
      <div className="border-t border-line px-6 py-4">
        <button
          type="button"
          onClick={() => openModal(ops, "removeClient", { id: c.id, name: c.name })}
          className="fw-s h-[38px] rounded-lg border border-[#FCA5A5] bg-white px-4 text-[13px] text-bad hover:bg-[#FEF2F2]"
        >
          Remove client
        </button>
      </div>
    ) : null;
  return [{ kicker: m.brandName(c.brandId), title: `${c.name} — Client details` }, body, foot];
}

/** What is on a day: holidays, approved leave and the tasks due. */
export function dayItems(ops: Ops, day: string, tasks: TaskW[]) {
  const { m, w } = ops;
  const hol = m.holidays.get(day);
  const leave = w.leaves.filter((l) => l.status === "approved" && l.from <= day && l.to >= day);
  return [
    ...(hol ? [{ key: "h", title: hol, meta: "Public holiday", bg: "#FDBA74", edge: "#FDBA74", status: null, go: () => {} }] : []),
    ...leave.map((l) => ({
      key: l.id,
      title: `${m.P(l.memberId).name} on leave`,
      meta: `${l.type} leave`,
      bg: "#fff",
      edge: "#2563EB",
      status: null,
      go: () => ops.setDrawer({ type: "person", id: l.memberId }),
    })),
    ...tasks.map((t) => {
      const st = m.stOf(t);
      return {
        key: t.id,
        title: t.title || "Untitled task",
        meta: `${m.tagOf(t)} · ${m.P(t.whoId).name}`,
        bg: DOT[st].bg,
        edge: DOT[st].edge,
        status: { label: DOT[st].label, bg: SCHIP[st][0], fg: SCHIP[st][1] },
        go: () => openTask(ops, t.id, { type: "day", day }),
      };
    }),
  ];
}

function DayDrawer({ ops, day }: { ops: Ops; day: string }): [{ kicker: string; title: string }, React.ReactNode, React.ReactNode] {
  const { m, w } = ops;
  const tasks = w.tasks.filter((t) => t.due === day);
  const items = dayItems(ops, day, tasks);
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(m.stOf(t), (counts.get(m.stOf(t)) ?? 0) + 1);
  const d = utc(day);
  const body = (
    <>
      <div className="flex flex-wrap gap-1.5">
        {[...counts.entries()].map(([k, n]) => (
          <span key={k} className="fw-s flex items-center gap-1.5 rounded-full bg-tint2 px-2.5 py-1 text-[11px] text-ink3">
            <span className="size-2 rounded-sm" style={{ background: DOT[k as keyof typeof DOT].bg, boxShadow: `inset 0 0 0 1px ${DOT[k as keyof typeof DOT].edge}` }} />
            {n} {DOT[k as keyof typeof DOT].label.toLowerCase()}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={t.go}
            className="flex w-full items-center gap-3 rounded-[10px] border border-edge bg-white px-3.5 py-3 text-left text-[13px] transition-colors hover:border-accent"
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: t.bg, boxShadow: `inset 0 0 0 1px ${t.edge}` }} />
            <span className="min-w-0 flex-1">
              <span className="fw-s block leading-[1.35]">{t.title}</span>
              <span className="text-xs text-mute">{t.meta}</span>
            </span>
            {t.status && (
              <span className="fw-s whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px]" style={{ background: t.status.bg, color: t.status.fg }}>
                {t.status.label}
              </span>
            )}
          </button>
        ))}
        {!items.length && <div className="rounded-[10px] border border-dashed border-edge3 px-4 py-7 text-center text-[13px] text-mute">Nothing due on this day.</div>}
      </div>
    </>
  );
  const foot =
    m.edits("tasks") && !m.previewing ? (
      <div className="border-t border-line px-6 py-4">
        <button
          type="button"
          onClick={() => openModal(ops, "task", { due: day })}
          className="fw-s h-11 w-full rounded-[10px] border-0 bg-accent text-sm text-white hover:bg-accent-h"
        >
          + Add Task
        </button>
      </div>
    ) : null;
  return [
    {
      kicker: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} due`,
      title: `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MNF[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    },
    body,
    foot,
  ];
}

// ───────────────────────────────────────────────────────────── quick add ───

const QUICK_TITLE: Record<QuickKind, string> = {
  client: "Add a client",
  member: "Add a team member",
  brand: "Add a brand",
  dept: "Add a department",
  tdept: "Add a task department",
  area: "Add an area",
  cat: "Add a category",
};

function QuickAdd() {
  const ops = useOps();
  const { quick, setQuick, w, m } = ops;
  if (!quick) return null;
  const q = quick;
  const set = (k: string, v: string) => setQuick((cur) => (cur ? { ...cur, form: { ...cur.form, [k]: v }, error: "" } : cur));
  const close = () => setQuick(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = (q.form.name ?? "").trim();
    if (!name) return setQuick((cur) => (cur ? { ...cur, error: "Enter a name." } : cur));
    setQuick((cur) => (cur ? { ...cur, busy: true } : cur));

    let r: Result<unknown>;
    let value = name;
    if (q.kind === "client") {
      const brand = q.form.brand || w.brands.find((b) => b.kind !== "startup")?.id || "";
      r = await ops.run(createClient({ name, brand }), { quiet: true });
      if (r.ok) value = (r.data as { id: string }).id;
    } else if (q.kind === "member") {
      r = await ops.run(createMember({ name, role: q.form.role || "Team member" }), { quiet: true });
      if (r.ok) value = (r.data as { id: string }).id;
    } else if (q.kind === "brand") {
      r = await ops.run(addBrand({ name, kind: q.form.kind }), { quiet: true });
      if (r.ok) value = (r.data as { id: string }).id;
    } else if (q.kind === "tdept") {
      r = await ops.run(addTaskDept({ name }), { quiet: true });
      if (r.ok) value = (r.data as { id: string }).id;
    } else if (q.kind === "dept") {
      r = await ops.run(addHrDept({ name }), { quiet: true });
    } else if (q.kind === "area") {
      const brandId = q.target === "draft" ? ops.draft.brand : (ops.modal?.form.brand ?? "");
      r = await ops.run(addArea({ brandId, name }), { quiet: true });
      value = `@${name}`;
    } else {
      r = await ops.run(addCategory({ type: ops.modal?.form.type === "in" ? "in" : "out", name }), { quiet: true });
    }

    if (!r.ok) return setQuick((cur) => (cur ? { ...cur, busy: false, error: r.ok ? "" : r.error } : cur));
    if (q.target === "form") ops.setModal((cur) => (cur ? { ...cur, form: { ...cur.form, [q.field]: value }, errors: { ...cur.errors, [q.field]: "" } } : cur));
    if (q.target === "draft") ops.setDraft((d) => ({ ...d, [q.field]: value }));
    setQuick(null);
    ops.toast(`${name} added.`);
  }

  const agencyBrands = w.brands.filter((b) => b.kind !== "startup");
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4" onClick={close}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[380px] animate-rise flex-col gap-3 rounded-xl bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,.25)]"
      >
        <h3 className="m-0 text-base">{QUICK_TITLE[q.kind]}</h3>
        <label className="fw-s flex flex-col gap-1.5 text-xs">
          Name
          <input
            autoFocus
            value={q.form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Type a name"
            className="fw-b h-[42px] rounded-lg border px-3 text-sm"
            style={{ borderColor: q.error ? "#DC2626" : "rgba(100,116,139,.35)" }}
          />
        </label>
        {q.kind === "client" && (
          <label className="fw-s flex flex-col gap-1.5 text-xs">
            Brand
            <select value={q.form.brand ?? ""} onChange={(e) => set("brand", e.target.value)} className="fw-b h-[42px] rounded-lg border border-[rgba(100,116,139,.35)] bg-white px-3 text-sm">
              {agencyBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {q.kind === "member" && (
          <label className="fw-s flex flex-col gap-1.5 text-xs">
            Role
            <input
              value={q.form.role ?? ""}
              onChange={(e) => set("role", e.target.value)}
              placeholder="e.g. Designer"
              className="fw-b h-[42px] rounded-lg border border-[rgba(100,116,139,.35)] px-3 text-sm"
            />
          </label>
        )}
        {q.kind === "brand" && (
          <label className="fw-s flex flex-col gap-1.5 text-xs">
            Type
            <select value={q.form.kind ?? "agency"} onChange={(e) => set("kind", e.target.value)} className="fw-b h-[42px] rounded-lg border border-[rgba(100,116,139,.35)] bg-white px-3 text-sm">
              <option value="agency">Works for clients</option>
              <option value="startup">Own product, with work areas</option>
            </select>
          </label>
        )}
        {q.error && <span className="text-xs text-bad-d">{q.error}</span>}
        {q.kind === "client" && !agencyBrands.length && <span className="text-xs text-mute">Add a brand that works for clients first.</span>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="fw-s h-10 rounded-full border border-[rgba(100,116,139,.35)] bg-white px-4 text-[13px]">
            Cancel
          </button>
          <button type="submit" disabled={q.busy || m.previewing} className="fw-s h-10 rounded-full border-0 bg-accent px-[18px] text-[13px] text-white disabled:bg-faint">
            {q.busy ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── notice ───

function NoticeModal() {
  const { notice, setNotice } = useOps();
  const [copied, setCopied] = useState(false);
  if (!notice) return null;
  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-[rgba(15,23,42,.45)] p-4" onClick={() => setNotice(null)}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[480px] animate-rise flex-col gap-3.5 rounded-[14px] bg-white p-6">
        <h2 className="m-0 text-lg">{notice.title}</h2>
        <p className="m-0 text-sm leading-[1.55] text-ink3">{notice.text}</p>
        <div className="flex gap-2">
          <input readOnly value={notice.link} onFocus={(e) => e.target.select()} className="h-11 min-w-0 flex-1 rounded-lg border border-edge2 bg-tint px-3 font-mono text-xs" />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(notice.link);
              setCopied(true);
            }}
            className="fw-s h-11 rounded-lg border-0 bg-accent px-4 text-[13px] text-white hover:bg-accent-h"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="m-0 text-xs text-mute">Anyone with this link can set the password, so send it the way you would send a password.</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setCopied(false);
            }}
            className="fw-s h-10 rounded-full border border-[rgba(100,116,139,.35)] bg-white px-4 text-[13px]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
