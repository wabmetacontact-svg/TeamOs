"use client";

import { useState } from "react";
import type { AuditKind } from "@/lib/types";
import { Icon, type IconName } from "../icons";
import { useOps } from "../store";
import { Chip } from "../ui";
import { atLabel } from "./dashboard";

const ICON: Record<AuditKind, IconName> = { access: "key", expense: "doc", team: "users", client: "database", task: "check" };

export function AuditView() {
  const { w, m } = useOps();
  const [kind, setKind] = useState<"all" | AuditKind>("all");
  const rows = w.audit.filter((a) => kind === "all" || a.kind === kind);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "All changes"],
            ["expense", "Money"],
            ["task", "Tasks"],
            ["access", "Access"],
            ["team", "Team"],
            ["client", "Clients"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={kind === id} label={label} onClick={() => setKind(id)} />
        ))}
      </div>
      <div className="rounded-lg border border-line bg-white px-5 py-1">
        {rows.map((a) => (
          <div key={a.id} className="flex gap-3.5 border-b border-line3 py-3.5 text-[13px] leading-[1.45]">
            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-[rgba(91,91,214,.1)]">
              <Icon name={ICON[a.kind] ?? "check"} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">
                <strong>{a.who}</strong> {a.text}
              </span>
              {(a.from || a.to) && (
                <span className="mt-1 inline-flex items-center gap-2 rounded bg-[rgba(91,91,214,.07)] px-2.5 py-[3px] text-xs">
                  <span className="text-mute line-through">{a.from || "None"}</span>
                  <span>→</span>
                  <strong className="text-ink2">{a.to}</strong>
                </span>
              )}
              <span className="mt-1 block text-xs text-mute">
                {a.target} · {atLabel(a.at, m.today)}
              </span>
            </span>
          </div>
        ))}
        {!rows.length && <p className="text-[13px] text-mute">Nothing recorded yet.</p>}
      </div>
      <p className="mx-0.5 mb-0 mt-3 text-xs text-mute">Entries are append-only and attributed. They cannot be edited from the interface.</p>
    </>
  );
}
