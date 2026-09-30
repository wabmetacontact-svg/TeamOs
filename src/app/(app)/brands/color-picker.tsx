"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { BRAND_PRESETS, brandHex, normalizeBrandColor, readableOn } from "@/lib/brand-colors";

/**
 * Presets for the common case, and any colour for the brand that has one.
 *
 * A native colour input rather than a custom wheel: every browser ships one,
 * it works with a keyboard and a screen reader, and on a phone it opens the
 * system picker. The hex box beside it is for pasting a brand's exact colour
 * from its style guide, which is what most people actually want.
 */
export function ColorPicker({
  value,
  onChange,
  name,
  id,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** When set, a hidden input carries the value in a plain form submit. */
  name?: string;
  id?: string;
}) {
  const current = brandHex(value);
  const [draft, setDraft] = useState(current);
  const [invalid, setInvalid] = useState(false);

  function commit(raw: string) {
    const next = normalizeBrandColor(raw);
    if (next) {
      setInvalid(false);
      setDraft(next);
      onChange(next);
    } else {
      setInvalid(true);
    }
  }

  return (
    <div className="grid gap-2.5">
      {name && <input type="hidden" name={name} value={current} />}

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preset colours">
        {BRAND_PRESETS.map((preset) => {
          const selected = current === preset.hex;
          return (
            <button
              key={preset.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.name}
              title={preset.name}
              onClick={() => commit(preset.hex)}
              className={`flex size-7 items-center justify-center rounded-full ring-offset-2 transition-shadow ${
                selected ? "ring-2 ring-[var(--fg)]" : "hover:ring-2 hover:ring-border"
              }`}
              style={{ backgroundColor: preset.hex }}
            >
              {selected && <Check className="size-3.5" style={{ color: readableOn(preset.hex) }} />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <label
          className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border shadow-card"
          style={{ backgroundColor: current }}
          title="Pick any colour"
        >
          <input
            id={id}
            type="color"
            value={current}
            onChange={(e) => commit(e.currentTarget.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label="Pick any colour"
          />
        </label>

        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
          aria-label="Hex colour"
          aria-invalid={invalid}
          spellCheck={false}
          className="h-9 w-28 rounded-lg border border-border bg-surface px-3 font-mono text-sm uppercase shadow-card outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 aria-invalid:border-[var(--red)]"
        />

        <span
          className="truncate rounded-md px-2 py-1 text-xs font-medium"
          style={{ backgroundColor: current, color: readableOn(current) }}
        >
          Preview
        </span>
      </div>

      {invalid && <p className="text-xs text-[var(--red)]">Use a hex colour like #2563eb.</p>}
    </div>
  );
}
