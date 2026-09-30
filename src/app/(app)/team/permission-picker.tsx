"use client";

import { RotateCcw } from "lucide-react";
import { MODULES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Feature access, module by module, as checkboxes.
 *
 * Starts from the role and shows every departure from it, so "Member, plus
 * approving" is visible as exactly that rather than as a wall of ticks
 * somebody has to compare against the role in their head.
 *
 * Two small rules keep a ticked set sensible: turning on anything in a module
 * turns on seeing it (approving entries you cannot see is not a thing), and
 * turning off seeing it turns the rest of that module off.
 */
export function PermissionPicker({
  value,
  onChange,
  roleName,
  roleKeys,
  grantable,
  disabled,
}: {
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  roleName: string;
  roleKeys: ReadonlySet<string>;
  /** Keys this person may turn on. Anything the role already has is always allowed. */
  grantable: ReadonlySet<string>;
  disabled?: boolean;
}) {
  const changes = MODULES.flatMap((m) => Object.keys(m.actions).map((a) => `${m.resource}:${a}`)).filter(
    (key) => value.has(key) !== roleKeys.has(key),
  ).length;

  function toggle(resource: string, action: string, on: boolean) {
    const key = `${resource}:${action}`;
    const next = new Set(value);
    const group = MODULES.find((m) => m.resource === resource)!;
    const hasView = "view" in group.actions;

    if (on) {
      next.add(key);
      if (hasView && action !== "view") next.add(`${resource}:view`);
    } else {
      next.delete(key);
      if (hasView && action === "view") {
        for (const other of Object.keys(group.actions)) next.delete(`${resource}:${other}`);
      }
    }
    onChange(next);
  }

  function reset() {
    const next = new Set(value);
    for (const m of MODULES) {
      for (const action of Object.keys(m.actions)) {
        const key = `${m.resource}:${action}`;
        if (roleKeys.has(key)) next.add(key);
        else next.delete(key);
      }
    }
    onChange(next);
  }

  return (
    <div className={cn("rounded-lg border border-border", disabled && "pointer-events-none opacity-60")}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="text-muted">
          {changes === 0 ? (
            <>Exactly what {roleName} gets</>
          ) : (
            <>
              <span className="font-medium text-fg">
                {changes} {changes === 1 ? "change" : "changes"}
              </span>{" "}
              from {roleName}
            </>
          )}
        </span>
        {changes > 0 && (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 font-medium text-muted hover:text-fg"
          >
            <RotateCcw className="size-3" />
            Reset to {roleName}
          </button>
        )}
      </div>

      <ul className="divide-y divide-border">
        {MODULES.map((group) => (
          <li
            key={group.resource}
            className="grid gap-1.5 px-3 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-center"
          >
            <span className="text-[13px] font-medium">{group.label}</span>
            <span className="flex flex-wrap gap-1.5">
              {Object.entries(group.actions).map(([action, label]) => {
                const key = `${group.resource}:${action}`;
                const checked = value.has(key);
                const fromRole = roleKeys.has(key);
                const locked = !checked && !fromRole && !grantable.has(key);
                const added = checked && !fromRole;
                const removed = !checked && fromRole;

                return (
                  <label
                    key={action}
                    title={
                      locked
                        ? "You do not have this yourself, so you cannot give it"
                        : added
                          ? `Added — ${roleName} does not include this`
                          : removed
                            ? `Removed — ${roleName} normally includes this`
                            : undefined
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors select-none",
                      checked ? "border-brand bg-brand/5" : "border-border hover:bg-surface-hover",
                      added && "border-emerald-400 bg-emerald-50 text-emerald-800",
                      removed && "border-dashed border-rose-300 text-rose-700 line-through",
                      locked && "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={(e) => toggle(group.resource, action, e.currentTarget.checked)}
                      className="size-3.5 accent-brand"
                    />
                    {label}
                  </label>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
