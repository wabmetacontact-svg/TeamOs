"use client";

import { FEATURES, FEATURE_IDS, LEVEL_LABEL, NEXT_LEVEL, PRESET_NAMES, type Feature, type Level } from "@/lib/access";
import { applyPreset, setFeature } from "@/app/(app)/actions/access";
import { useOps } from "../store";

const STYLE: Record<Level | "owner", { bg: string; fg: string; border: string }> = {
  none: { bg: "#fff", fg: "#94A3B8", border: "#E2E8F0" },
  view: { bg: "#EFF6FF", fg: "#1D4ED8", border: "#BFDBFE" },
  edit: { bg: "#5B5BD6", fg: "#fff", border: "#5B5BD6" },
  owner: { bg: "#0F172A", fg: "#fff", border: "#0F172A" },
};

export function AccessView() {
  const ops = useOps();
  const { m } = ops;
  const canManage = m.edits("access") && !m.previewing;

  function cycle(memberId: string, f: Feature, current: Level) {
    const next: Level = f === "dashcards" ? (current === "none" ? "view" : "none") : NEXT_LEVEL[current];
    const member = m.P(memberId);
    // Shown at once; the server's answer confirms it or puts it back.
    ops.apply({ upsert: { members: [{ ...member, features: { ...member.features, [f]: next } }] } });
    ops.run(setFeature({ memberId, feature: f, level: next })).then((r) => {
      if (!r.ok) ops.apply({ upsert: { members: [member] } });
    });
  }

  return (
    <>
      <p className="m-0 mb-1.5 max-w-[72ch] text-[13px] text-mute2">
        Choose which sections of the platform each person can use. No access hides the section from their sidebar. View is read only. Edit lets them
        add, change and delete.
      </p>
      <p className="m-0 mb-4 text-xs text-mute">
        {canManage ? "Changes apply immediately and are recorded in the audit trail." : "You can see these settings. Only people with Edit on Access can change them."}
      </p>
      <div className="mb-3.5 flex flex-wrap gap-4 text-xs text-mute2">
        {(
          [
            ["none", "No access, hidden from sidebar"],
            ["view", "View, read only"],
            ["edit", "Edit, add, change and delete"],
            ["owner", "Owner, always full access"],
          ] as const
        ).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-3.5 rounded border" style={{ background: STYLE[k].bg, borderColor: STYLE[k].border }} />
            {label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-edge bg-white">
        <table className="w-full min-w-[1040px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 min-w-[180px] border-b border-edge bg-tint px-4 py-3 text-left text-[10px] uppercase tracking-[.08em] text-mute">Person</th>
              {FEATURES.map(([, label]) => (
                <th key={label} className="border-b border-edge bg-tint px-1.5 py-3 text-center text-[10px] uppercase tracking-[.08em] text-mute">
                  {label}
                </th>
              ))}
              <th className="border-b border-edge bg-tint px-4 py-3 text-left text-[10px] uppercase tracking-[.08em] text-mute">Role preset</th>
            </tr>
          </thead>
          <tbody>
            {m.team.map((p) => {
              const locked = p.isOwner || !canManage || p.id === m.me.id;
              const count = FEATURE_IDS.filter((f) => m.fa(f, p) !== "none").length;
              return (
                <tr key={p.id}>
                  <td className="sticky left-0 border-b border-tint2 bg-white px-4 py-2.5">
                    <span className="fw-s block text-[13px]">{p.name}</span>
                    <span className="text-mute">
                      {p.title} · {p.isOwner ? "full access" : `${count} of ${FEATURE_IDS.length} sections`}
                    </span>
                  </td>
                  {FEATURE_IDS.map((f) => {
                    const l: Level | "owner" = p.isOwner ? "owner" : m.fa(f, p);
                    const st = STYLE[l];
                    const label = p.isOwner ? "Full" : f === "dashcards" ? (l === "none" ? "Hidden" : "Shown") : LEVEL_LABEL[l as Level];
                    return (
                      <td key={f} className="border-b border-tint2 p-1.5 text-center">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => cycle(p.id, f, l as Level)}
                          className="fw-s h-8 w-full min-w-[78px] rounded-lg border text-[11px] transition-colors"
                          style={{ background: st.bg, color: st.fg, borderColor: st.border, cursor: locked ? "default" : "pointer" }}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-tint2 px-4 py-1.5">
                    <select
                      value=""
                      disabled={locked}
                      onChange={(e) => e.target.value && ops.run(applyPreset({ memberId: p.id, preset: e.target.value }))}
                      className="h-8 min-w-[130px] rounded-lg border border-edge2 bg-white px-2 text-xs disabled:bg-tint"
                    >
                      <option value="">Apply preset…</option>
                      {PRESET_NAMES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mx-0.5 mb-0 mt-3 text-xs text-mute">Which clients a person can see is set per client, on that client&apos;s Access tab.</p>
    </>
  );
}
