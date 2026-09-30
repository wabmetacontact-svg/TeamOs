"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { moveStage } from "./actions";

type Stage = { id: string; name: string; isTerminal: boolean; count: number; value: string };
type Card = {
  id: string;
  personId: string;
  personName: string;
  personEmail: string | null;
  stageId: string | null;
  ownerName: string | null;
  clientName: string | null;
  value: string | null;
  currency: string;
  activities: number;
};

/**
 * Columns, with a stage picker on each card rather than drag and drop.
 *
 * Dragging is nicer on a laptop and unusable on a phone, and a stage move is
 * the one edit here that writes history — it should be a deliberate choice, not
 * something a stray gesture can do. The picker works everywhere and with a
 * keyboard.
 */
export function PipelineBoard({ stages, cards, canEdit }: { stages: Stage[]; cards: Card[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <div className="scrollbar-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {stages.map((stage) => {
          const inStage = cards.filter((c) => c.stageId === stage.id);

          return (
            <section
              key={stage.id}
              className="flex w-72 shrink-0 snap-start flex-col rounded-xl border border-border bg-surface-2"
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2.5">
                <h2 className="truncate text-sm font-medium">
                  {stage.name}
                  {stage.isTerminal && <span className="ml-1.5 text-xs font-normal text-subtle">closed</span>}
                </h2>
                <span className="shrink-0 text-xs text-muted">
                  {stage.count}
                  {stage.value !== "0" && ` · ${short(stage.value)}`}
                </span>
              </header>

              <div className="grid gap-2 p-2">
                {inStage.length === 0 && <p className="px-1 py-3 text-center text-xs text-subtle">Nothing here</p>}

                {inStage.map((card) => (
                  <article key={card.id} className="rounded-lg border border-border bg-surface p-2.5 shadow-card">
                    <Link href={`/people/${card.personId}`} className="block hover:underline">
                      <p className="truncate text-sm font-medium">{card.personName}</p>
                    </Link>

                    <p className="mt-0.5 truncate text-xs text-muted">
                      {[card.ownerName, card.clientName].filter(Boolean).join(" · ") || "Unowned"}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {card.value && (
                        <Badge tone="green">
                          {card.currency} {short(card.value)}
                        </Badge>
                      )}
                      {card.activities > 0 && (
                        <span className="flex items-center gap-1 text-xs text-subtle">
                          <MessageSquare className="size-3" />
                          {card.activities}
                        </span>
                      )}
                    </div>

                    {canEdit && stages.length > 1 && (
                      <Select
                        aria-label={`Stage for ${card.personName}`}
                        value={card.stageId ?? ""}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            setError(null);
                            const result = await moveStage({ id: card.id, stageId: e.currentTarget.value });
                            if (result.ok) router.refresh();
                            else setError(result.error);
                          })
                        }
                        className="mt-2 h-7 text-xs"
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 50000000 minor units → 5L. Indian grouping, because the numbers are. */
function short(minor: string): string {
  const major = Number(minor) / 100;
  if (major >= 10_000_000) return `${trim(major / 10_000_000)}Cr`;
  if (major >= 100_000) return `${trim(major / 100_000)}L`;
  if (major >= 1_000) return `${trim(major / 1_000)}K`;
  return String(Math.round(major));
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, "");
}
