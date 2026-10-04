"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CLIENT_LEVEL_LABEL } from "@/lib/access";
import { dLabel, dLong, fmtCur, initials, inr, inrShort } from "@/lib/format";
import { STATUS } from "@/lib/labels";
import { setGrant } from "@/app/(app)/actions/clients";
import { Icon } from "../icons";
import { openModal } from "../modals";
import { openTask } from "../overlays";
import { useOps } from "../store";
import { Section, Tabs, TextLink } from "../ui";
import { atLabel } from "./dashboard";
import { ClientAccount } from "./client-account";

type Tab = "overview" | "account" | "expenses" | "tasks" | "access" | "history";

export function ClientView({ id }: { id: string }) {
  const ops = useOps();
  const { w, m } = ops;
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const c = m.C(id);

  if (!c || !m.visIds.has(c.id)) {
    return (
      <div className="rounded-xl border border-dashed border-edge3 bg-white px-5 py-8 text-[13px] text-mute">
        This client does not exist, or you do not have access to it.{" "}
        <TextLink onClick={() => router.push("/clients")} className="text-[13px]">
          Back to clients
        </TextLink>
      </div>
    );
  }

  const f = m.finIds.has(c.id);
  const st = m.stats(c);
  const tasks = w.tasks.filter((t) => t.clientId === c.id);
  const hours = new Map<string, number>();
  for (const t of tasks) hours.set(t.whoId, (hours.get(t.whoId) ?? 0) + (t.hours || 0));
  const hMax = Math.max(1, ...hours.values());
  const received = w.ledger.filter((e) => e.type === "in" && e.clientId === c.id && e.status === "paid" && (!c.sinceDate || e.date >= c.sinceDate));
  const fx = received.filter((e) => e.orig && e.currency);
  const fxCur = [...new Set(fx.map((e) => e.currency))];
  const history = w.audit.filter((a) => a.clientId === c.id);
  const access = m.lvl(m.viewer.id, c.id);
  const finPeople = m.team.filter((p) => ["owner", "finance"].includes(m.lvl(p.id, c.id))).map((p) => p.name);
  const month = new Date(`${m.thisMonth}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const canAddTask = m.edits("tasks") && m.can(c.id, "edit") && !m.previewing;

  const cards = [
    {
      label: "Received since onboarding",
      value: f ? inr(received.reduce((a, e) => a + e.amount, 0)) : "Restricted",
      color: f ? "#16A34A" : "#64748B",
      note: f
        ? `${received.length} ${received.length === 1 ? "payment" : "payments"}${
            fxCur.length === 1 && fx.length === received.length ? ` · ${fmtCur(fx.reduce((a, e) => a + (e.orig ?? 0), 0), fxCur[0]!)}` : ""
          } · since ${c.sinceDate ? dLong(c.sinceDate) : "—"}`
        : null,
    },
    { label: `Retainer, ${month}`, value: f ? inrShort(c.retainer ?? 0) : "Restricted", color: "#111827", note: null },
    { label: `Cost, ${month}`, value: f ? inrShort(st.cost) : "Restricted", color: "#111827", note: null },
    { label: "Margin", value: f ? inrShort(st.margin) : "Restricted", color: !f ? "#64748B" : st.margin < 0 ? "#DC2626" : "#16A34A", note: null },
    { label: "Hours logged", value: `${st.hrs}h`, color: "#111827", note: null },
  ];

  const rowBtn = "flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-0 border-b border-line3 bg-transparent px-5 py-[13px] text-left text-[13px] hover:bg-[rgba(91,91,214,.06)]";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="fw-s flex size-[52px] items-center justify-center rounded-lg bg-accent text-white">{initials(c.name)}</span>
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="fw-s rounded-full bg-[rgba(91,91,214,.12)] px-2.5 py-[3px] text-[11px] text-ink2">{m.brandName(c.brandId)}</span>
            <span className="fw-s rounded-full border border-[rgba(100,116,139,.35)] px-2.5 py-[3px] text-[11px]">Your access: {CLIENT_LEVEL_LABEL[access]}</span>
          </div>
          <div className="mt-1.5 text-[13px] text-mute">
            Client since {c.sinceDate ? dLong(c.sinceDate) : "—"} · Main contact {c.contact || "Not set"}
          </div>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {cards.map((s) => (
          <div key={s.label} className="rounded-lg border border-line bg-white px-4 py-3.5">
            <div className="text-xs text-mute">{s.label}</div>
            <div className="fw-s tnum mt-1 text-[22px] tracking-[-.02em]" style={{ color: s.color }}>
              {s.value}
            </div>
            {s.note && <div className="mt-1 text-xs text-mute">{s.note}</div>}
          </div>
        ))}
      </div>

      <Tabs
        className="mb-4 mt-6"
        active={tab}
        onPick={setTab}
        tabs={[
          ["overview", "Overview"],
          ["account", "Account"],
          ["expenses", "Money"],
          ["tasks", `Tasks (${tasks.length})`],
          ["access", "Access"],
          ["history", "History"],
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
          <Section>
            <h2 className="m-0 mb-3 text-[15px]">Who worked on them</h2>
            {[...hours.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([pid, h]) => (
                <div key={pid} className="flex flex-col gap-1.5 py-2">
                  <div className="flex justify-between text-[13px]">
                    <span className="fw-s">{m.P(pid).name}</span>
                    <span>
                      {h}h · {f ? inr(h * w.tenant.hourlyRate) : "cost restricted"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-sm bg-[rgba(91,91,214,.1)]">
                    <div className="h-full rounded-sm bg-accent" style={{ width: `${(h / hMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            {![...hours.values()].some((h) => h > 0) && <p className="m-0 text-[13px] text-mute">No hours logged yet.</p>}
          </Section>
          <Section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="m-0 text-[15px]">Open tasks</h2>
              {canAddTask && <TextLink onClick={() => openModal(ops, "task", { client: c.id })}>+ Add</TextLink>}
            </div>
            {tasks
              .filter((t) => t.status !== "done")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTask(ops, t.id)}
                  className="flex w-full items-center gap-2.5 border-0 border-t border-[rgba(100,116,139,.15)] bg-transparent py-[9px] text-left text-[13px]"
                >
                  <span className="fw-s flex-1">{t.title || "Untitled task"}</span>
                  <span className="whitespace-nowrap text-xs text-mute">
                    {STATUS.find((x) => x.id === t.status)?.label} · {dLabel(t.due)}
                  </span>
                </button>
              ))}
            {!tasks.some((t) => t.status !== "done") && <p className="m-0 text-[13px] text-mute">Nothing open.</p>}
          </Section>
        </div>
      )}

      {/* Keyed on the client so switching clients resets the form, not just its values. */}
      {tab === "account" && <ClientAccount key={c.id} c={c} />}

      {tab === "expenses" &&
        (f ? (
          <>
            {m.edits("expenses") && !m.previewing && (
              <div className="mb-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => openModal(ops, "entry", { type: "out", client: c.id })}
                  className="fw-s h-[34px] rounded-full border-0 bg-ink2 px-4 text-xs text-white"
                >
                  + Add entry
                </button>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              {w.ledger
                .filter((e) => e.clientId === c.id)
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((e) => (
                  <button key={e.id} type="button" onClick={() => openModal(ops, "editEntry", e as unknown as Record<string, unknown>)} className={rowBtn}>
                    <span className="min-w-0 flex-[1_1_220px]">
                      <span className="fw-s block">{e.desc}</span>
                      <span className="text-xs text-mute">
                        {dLabel(e.date)} · {e.category} · {e.status === "pending" ? "Pending" : e.type === "in" ? "Received" : "Paid"}
                      </span>
                    </span>
                    <span className="fw-s" style={{ color: e.type === "in" ? "#16A34A" : "#DC2626" }}>
                      {e.type === "in" ? "+" : "−"}
                      {inr(e.amount)}
                    </span>
                  </button>
                ))}
              {!w.ledger.some((e) => e.clientId === c.id) && <p className="m-0 px-5 py-4 text-[13px] text-mute">No money recorded yet.</p>}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-[rgba(100,116,139,.4)] bg-white p-6 text-[13px]">
            <Icon name="lock" size={22} />
            Finance access is required to see this client&apos;s money. Ask the founder for a Finance grant.
          </div>
        ))}

      {tab === "tasks" && (
        <>
          {canAddTask && (
            <div className="mb-2.5 flex justify-end">
              <button type="button" onClick={() => openModal(ops, "task", { client: c.id })} className="fw-s h-[34px] rounded-full border-0 bg-ink2 px-4 text-xs text-white">
                + Add task
              </button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            {[...tasks]
              .sort((a, b) => (b.due ?? "").localeCompare(a.due ?? ""))
              .map((t) => {
                const done = t.status === "done";
                return (
                  <button key={t.id} type="button" onClick={() => openTask(ops, t.id)} className={rowBtn}>
                    <span className="fw-s flex-[1_1_220px]">{t.title || "Untitled task"}</span>
                    <span className="text-xs text-mute">
                      {m.P(t.whoId).name} · {t.hours}h · due {dLabel(t.due)}
                    </span>
                    <span
                      className="fw-s rounded-full px-2.5 py-[3px] text-[11px]"
                      style={{ background: done ? "#111827" : "rgba(91,91,214,.12)", color: done ? "#fff" : "#111827" }}
                    >
                      {STATUS.find((x) => x.id === t.status)?.label}
                    </span>
                  </button>
                );
              })}
            {!tasks.length && <p className="m-0 px-5 py-4 text-[13px] text-mute">No tasks for this client yet.</p>}
          </div>
        </>
      )}

      {tab === "access" && (
        <Section>
          <h2 className="m-0 mb-1 text-[15px]">Who has access to {c.name}</h2>
          <p className="m-0 mb-4 text-[13px] text-mute">
            Finance access: {finPeople.join(", ") || "nobody"}.{" "}
            {m.isOwner && !m.previewing ? "Changes apply immediately and are recorded." : "Only an owner can change these."}
          </p>
          {m.team.map((p) => {
            const level = m.lvl(p.id, c.id);
            const locked = !m.me.isOwner || m.previewing || p.isOwner;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 border-t border-[rgba(100,116,139,.15)] py-2.5 text-[13px]">
                <span className="fw-s flex size-[30px] items-center justify-center rounded bg-[rgba(91,91,214,.12)] text-[11px] text-ink2">{initials(p.name)}</span>
                <span className="min-w-[120px] flex-1">
                  <span className="fw-s block">{p.name}</span>
                  <span className="text-xs text-mute">{p.title}</span>
                </span>
                <select
                  value={level}
                  disabled={locked}
                  onChange={(e) => ops.run(setGrant({ memberId: p.id, clientId: c.id, level: e.target.value as never }))}
                  className="h-9 min-w-[130px] rounded-lg border border-line2 bg-white px-2.5 text-[13px] disabled:bg-tint"
                >
                  {p.isOwner && <option value="owner">Owner</option>}
                  <option value="none">No access</option>
                  <option value="view">View</option>
                  <option value="edit">Edit</option>
                  <option value="finance">Finance</option>
                </select>
              </div>
            );
          })}
        </Section>
      )}

      {tab === "history" && (
        <div className="rounded-lg border border-line bg-white px-5 py-1">
          {history.map((a) => (
            <div key={a.id} className="flex flex-wrap gap-3 border-b border-line3 py-3 text-[13px]">
              <span className="flex-[1_1_260px]">
                <strong>{a.who}</strong> {a.text}
                {(a.from || a.to) && (
                  <span className="mt-0.5 block text-xs text-mute">
                    {a.from || "None"} → <strong className="text-ink2">{a.to}</strong>
                  </span>
                )}
              </span>
              <span className="text-xs text-mute">{atLabel(a.at, m.today)}</span>
            </div>
          ))}
          {!history.length && <p className="text-[13px] text-mute">No recorded changes yet.</p>}
        </div>
      )}
    </>
  );
}
