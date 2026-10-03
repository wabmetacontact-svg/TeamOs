"use client";

import { cn } from "@/lib/utils";
import { Icon } from "./icons";

/**
 * Small pieces every screen shares, styled as the prototype styles them.
 */

export function Section({ className, children, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-lg border border-line bg-white p-5", className)} {...rest}>
      {children}
    </section>
  );
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-lg border border-line bg-white", className)}>{children}</div>;
}

export function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("m-0 text-[15px]", className)}>{children}</h2>;
}

/** A section heading with a link on the right. */
export function HeadRow({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <H2>{title}</H2>
      {action}
    </div>
  );
}

export function TextLink({ onClick, children, className }: { onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn("fw-s text-xs", className)}
    >
      {children}
    </a>
  );
}

/** Uppercase kicker, big number, note — the money and payroll cards. */
export function StatCard({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-white px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-[.1em] text-mute">{label}</div>
      <div className="fw-s tnum mt-1.5 text-2xl" style={{ color: color ?? "#0F172A" }}>
        {value}
      </div>
      {note != null && <div className="mt-0.5 text-[11px] text-mute">{note}</div>}
    </div>
  );
}

export function CardGrid({ children, min = 170, className }: { children: React.ReactNode; min?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)} style={{ gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))` }}>
      {children}
    </div>
  );
}

/** ← Month → and a "Today" button. */
export function MonthNav({
  label,
  prev,
  next,
  today,
  todayLabel = "Today",
  big = true,
  children,
  bordered = "line",
}: {
  label: string;
  prev: () => void;
  next: () => void;
  today?: () => void;
  todayLabel?: string;
  big?: boolean;
  children?: React.ReactNode;
  bordered?: "line" | "edge";
}) {
  const border = bordered === "edge" ? "border-edge2" : "border-line2";
  const arrow = `flex size-9 items-center justify-center rounded-lg border ${border} bg-white`;
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      <button type="button" onClick={prev} aria-label="Previous month" className={arrow}>
        <Icon name="arrow" size={16} style={{ transform: "rotate(180deg)" }} />
      </button>
      {big ? (
        <h2 className="mx-1.5 my-0 min-w-[150px] text-center text-xl">{label}</h2>
      ) : (
        <span className={`fw-s flex h-9 min-w-[150px] items-center justify-center rounded-lg border ${border} px-4 text-sm`}>{label}</span>
      )}
      <button type="button" onClick={next} aria-label="Next month" className={arrow}>
        <Icon name="arrow" size={16} />
      </button>
      {!big && today && <TodayButton onClick={today} label={todayLabel} border={border} />}
      <span className="flex-1" />
      {big && today && <TodayButton onClick={today} label={todayLabel} border={border} />}
      {children}
    </div>
  );
}

function TodayButton({ onClick, label, border }: { onClick: () => void; label: string; border: string }) {
  return (
    <button type="button" onClick={onClick} className={`fw-s h-9 rounded-lg border ${border} bg-white px-3.5 text-xs`}>
      {label}
    </button>
  );
}

/** Rounded filter chip: black when active, with an optional × to remove. */
export function Chip({
  active,
  label,
  onClick,
  onRemove,
  removeTitle,
  size = "md",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onRemove?: () => void;
  removeTitle?: string;
  size?: "sm" | "md";
}) {
  const h = size === "sm" ? "h-[30px] text-[11px]" : "h-[34px] text-xs";
  const colors = active ? "border-ink2 bg-ink2 text-white" : "border-line2 bg-white text-ink";
  if (!onRemove) {
    return (
      <button type="button" onClick={onClick} className={cn("fw-s rounded-full border", size === "sm" ? "px-3" : "px-3.5", h, colors)}>
        {label}
      </button>
    );
  }
  return (
    <span className={cn("flex items-center overflow-hidden rounded-full border", h, colors)}>
      <button type="button" onClick={onClick} className={cn("fw-s h-full border-0 bg-transparent text-inherit", size === "sm" ? "px-3" : "px-3.5")} style={{ color: "inherit" }}>
        {label}
      </button>
      <button
        type="button"
        onClick={onRemove}
        title={removeTitle}
        className="h-full border-0 bg-transparent pl-0.5 pr-2.5 leading-none opacity-60 hover:opacity-100"
        style={{ color: "inherit", fontSize: size === "sm" ? 13 : 14 }}
      >
        ×
      </button>
    </span>
  );
}

/** "+ Add something" with a dashed outline. */
export function DashedAdd({ onClick, children, size = "md" }: { onClick: () => void; children: React.ReactNode; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "fw-s rounded-full border border-dashed",
        size === "sm" ? "h-[30px] border-[#A5A5EA] bg-white px-3 text-[11px] text-accent" : "h-[34px] border-[rgba(91,91,214,.6)] bg-transparent px-3.5 text-xs text-ink2",
      )}
    >
      {children}
    </button>
  );
}

/** A coloured pill: status, priority, tag. */
export function Pill({ bg, fg, children, className, title }: { bg: string; fg: string; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("fw-s inline-block rounded-full px-[9px] py-[3px] text-[11px] whitespace-nowrap", className)} style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}

export function Avatar({ text, size = 36, dark, round }: { text: string; size?: number; dark?: boolean; round?: boolean }) {
  return (
    <span
      className={cn("fw-s flex shrink-0 items-center justify-center", round ? "rounded-full" : "rounded")}
      style={{
        width: size,
        height: size,
        fontSize: size >= 36 ? 12 : 11,
        background: dark ? "#111827" : round ? "#EEF0FF" : "rgba(91,91,214,.14)",
        color: dark ? "#fff" : round ? "#4338CA" : "#111827",
      }}
    >
      {text}
    </span>
  );
}

/** Underlined tabs. */
export function Tabs<T extends string>({ tabs, active, onPick, className }: { tabs: [T, string][]; active: T; onPick: (t: T) => void; className?: string }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(id)}
          className="fw-s -mb-px whitespace-nowrap border-0 bg-transparent px-3.5 py-2.5 text-[13px]"
          style={{ borderBottom: `2px solid ${active === id ? "#5B5BD6" : "transparent"}`, color: active === id ? "#0F172A" : "#64748B" }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A segmented control: one of a few options, the active one raised. */
export function Segmented<T extends string>({
  options,
  active,
  onPick,
  className,
  height = 36,
}: {
  options: [T, string][];
  active: T;
  onPick: (t: T) => void;
  className?: string;
  height?: number;
}) {
  return (
    <div className={cn("grid gap-1 rounded-lg bg-[rgba(100,116,139,.1)] p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length},1fr)` }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(id)}
          className="fw-s rounded-md border-0 text-[13px]"
          style={{ height, background: active === id ? "#fff" : "transparent", color: active === id ? "#111827" : "#64748B" }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-edge3 bg-white px-5 py-8 text-[13px] text-mute", className)}>
      <span className="min-w-[200px] flex-1">{children}</span>
      {action}
    </div>
  );
}

export function LockNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3.5 rounded-xl border border-dashed border-edge3 bg-white p-6 text-[13px] text-mute2", className)} style={{ ["--icon-stroke" as string]: "#5B5BD6" }}>
      <Icon name="lock" size={22} />
      <span>{children}</span>
    </div>
  );
}

const btnBase = "fw-s inline-flex items-center justify-center whitespace-nowrap border-0 text-xs";

export function PrimaryButton({ className, ...rest }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(btnBase, "h-9 rounded-lg bg-accent px-4 text-white hover:bg-accent-h active:bg-accent-d disabled:bg-faint", className)} {...rest} />;
}

export function DarkButton({ className, ...rest }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(btnBase, "h-[34px] rounded-full bg-ink2 px-4 text-white disabled:bg-faint", className)} {...rest} />;
}

export function OutlineButton({ className, ...rest }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(btnBase, "h-[34px] rounded-lg border border-edge2 bg-white px-3.5 hover:bg-tint disabled:opacity-60", className)} {...rest} />;
}

/** A small native select used by filters. */
export function FilterSelect({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-[38px] min-w-0 rounded-lg border border-edge2 bg-white px-2.5 text-xs", className)}>
      {children}
    </select>
  );
}
