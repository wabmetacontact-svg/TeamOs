/**
 * Brand colours: a handful of presets, or any colour somebody picks.
 *
 * Stored as a lowercase `#rrggbb` string. The six named presets the first
 * version shipped with ("blue", "green"…) are still accepted on read, because
 * brands created before custom colours hold those names in the database and a
 * rename should not be the thing that fixes them.
 *
 * No directive at the top of this file, deliberately: the picker on the client
 * and the validation in the server action both need it. See lib/ui-enums.ts for
 * what happens when a shared value lives in a "use server" module instead.
 */

export const BRAND_PRESETS = [
  { name: "Blue", hex: "#2563eb" },
  { name: "Green", hex: "#059669" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Red", hex: "#e11d48" },
  { name: "Purple", hex: "#7c3aed" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Pink", hex: "#db2777" },
  { name: "Amber", hex: "#d97706" },
  { name: "Slate", hex: "#64748b" },
] as const;

/** The names the first version stored, mapped to what they looked like. */
const LEGACY: Record<string, string> = {
  blue: "#3b82f6",
  green: "#10b981",
  orange: "#f97316",
  red: "#f43f5e",
  purple: "#8b5cf6",
  slate: "#94a3b8",
};

const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_BRAND_COLOR = BRAND_PRESETS[0].hex;

/** Whatever is stored, as a colour a browser can paint. Never throws. */
export function brandHex(stored: string | null | undefined): string {
  if (!stored) return LEGACY.slate!;
  if (HEX.test(stored)) return stored.toLowerCase();
  return LEGACY[stored.toLowerCase()] ?? LEGACY.slate!;
}

/**
 * What a form sent, as what gets stored — or null when it is not a colour.
 *
 * Accepts `#rgb` shorthand and a missing `#`, because that is what people type
 * into a hex box, and turns both into the one stored form.
 */
export function normalizeBrandColor(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw in LEGACY) return LEGACY[raw]!;

  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return HEX.test(hex) ? hex : null;
}

/**
 * Black or white, whichever reads on top of the colour.
 *
 * A custom colour means somebody can pick pale yellow, and white text on pale
 * yellow is unreadable. Relative luminance per WCAG, with the usual threshold.
 */
export function readableOn(hex: string): "#ffffff" | "#0f172a" {
  const c = brandHex(hex);
  const channel = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? "#0f172a" : "#ffffff";
}
