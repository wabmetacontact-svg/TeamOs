/**
 * The icon set, drawn once as an SVG sprite and referenced with <use>. Stroke
 * colour comes from --icon-stroke so a parent can recolour every icon inside
 * it (the dark sidebar, the toast) without touching the icons.
 */

const stroke = { fill: "none", stroke: "var(--icon-stroke,currentColor)", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function IconSprite() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <symbol id="i-grid" viewBox="0 0 24 24" {...stroke}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </symbol>
      <symbol id="i-database" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4" />
      </symbol>
      <symbol id="i-users" viewBox="0 0 24 24" {...stroke}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
      </symbol>
      <symbol id="i-network" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10.5" r="2.5" />
        <path d="M5.5 17c.6-1.7 1.9-2.5 3.5-2.5s2.9.8 3.5 2.5M15 10h3M15 14h3" />
      </symbol>
      <symbol id="i-doc" viewBox="0 0 24 24" {...stroke}>
        <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21zM9 8h6M9 12h6M9 16h3" />
      </symbol>
      <symbol id="i-megaphone" viewBox="0 0 24 24" {...stroke}>
        <path d="M3 10v4h3l7 4V6L6 10zM16.5 8.5a5 5 0 010 7M6 14l1.5 5h3L9 14.9" />
      </symbol>
      <symbol id="i-target" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 12.5l2.5 2.5L16 9.5" />
      </symbol>
      <symbol id="i-key" viewBox="0 0 24 24" {...stroke}>
        <circle cx="8" cy="15" r="4" />
        <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24" {...stroke}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24" {...stroke}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </symbol>
      <symbol id="i-settings" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
      </symbol>
    </svg>
  );
}

export type IconName =
  | "grid"
  | "megaphone"
  | "target"
  | "database"
  | "users"
  | "network"
  | "doc"
  | "check"
  | "key"
  | "shield"
  | "search"
  | "arrow"
  | "lock"
  | "settings";

export function Icon({ name, size = 20, style, className }: { name: IconName; size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg width={size} height={size} style={{ flexShrink: 0, ...style }} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
