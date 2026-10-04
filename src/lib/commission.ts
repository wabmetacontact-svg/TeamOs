/**
 * Commission for one month.
 *
 * The same function works out what the Payroll screen shows and what paying
 * it writes to the ledger, so the number on the screen and the number paid can
 * never be two different calculations that happen to agree today.
 *
 * Everything is in paise, as integers. A rate is in basis points (1000 = 10%).
 * Rounding happens once per member per rate, not once per payment: rounding
 * every small payment separately would drift by a paisa a payment.
 *
 * The rules:
 *
 *   AUTOMATIC  a member's rate x the money their own clients actually paid in
 *              the month - "own" meaning the clients credited to them as the
 *              person who brought them in. Each payment is worked out at the
 *              rate in force on the day it arrived, so changing a rate never
 *              rewrites a month already earned.
 *
 *   BY HAND    on top of that, any commission given to anybody: a fixed amount
 *              once (a bonus, a fee per onboarding) or every month, or a share
 *              of what one client paid that month.
 *
 *   RECEIVED   only money in, and only once it is marked paid. Pending money is
 *              not money yet. Categories listed in `skip` earn nothing - for
 *              instance wallet top-ups, which are mostly passed on to Meta.
 */

export type CommissionEntry = {
  type: "in" | "out";
  status: "paid" | "pending";
  clientId: string | null;
  /** yyyy-MM-dd */
  date: string;
  category: string;
  amountPaise: number;
};

export type CommissionRate = { memberId: string; /** yyyy-MM-dd */ from: string; bps: number };

export type CommissionRuleInput = {
  id: string;
  memberId: string;
  clientId: string | null;
  kind: "fixed" | "percent";
  amountPaise: number;
  bps: number;
  repeat: "once" | "monthly";
  /** yyyy-MM */
  fromMonth: string;
  /** yyyy-MM, or null for open-ended */
  toMonth: string | null;
  note: string;
};

export type CommissionLine = {
  kind: "auto" | "rule";
  ruleId?: string;
  clientId?: string | null;
  /** What it is a share of, when it is a share. */
  basePaise?: number;
  bps?: number;
  amountPaise: number;
  note?: string;
};

export type CommissionRow = {
  memberId: string;
  autoPaise: number;
  /** The money their own clients paid that counted toward it. */
  autoBasePaise: number;
  rulePaise: number;
  totalPaise: number;
  lines: CommissionLine[];
};

const share = (basePaise: number, bps: number) => Math.round((basePaise * bps) / 10_000);

/** Whether a by-hand commission counts in month `ym`. */
export function ruleApplies(rule: Pick<CommissionRuleInput, "repeat" | "fromMonth" | "toMonth">, ym: string): boolean {
  if (ym < rule.fromMonth) return false;
  if (rule.repeat === "once") return ym === rule.fromMonth;
  return rule.toMonth === null || ym <= rule.toMonth;
}

/** The rate a member had on a given day: the latest one that had begun by then. */
export function rateOn(rates: CommissionRate[], memberId: string, day: string): number {
  let best: CommissionRate | null = null;
  for (const r of rates) {
    if (r.memberId !== memberId || r.from > day) continue;
    if (!best || r.from > best.from) best = r;
  }
  return best?.bps ?? 0;
}

export function commissionsFor(input: {
  /** yyyy-MM */
  ym: string;
  clients: { id: string; ownerId: string | null }[];
  entries: CommissionEntry[];
  rates: CommissionRate[];
  rules: CommissionRuleInput[];
  /** Income categories that earn no commission. */
  skip?: string[];
}): Map<string, CommissionRow> {
  const { ym, clients, entries, rates, rules } = input;
  const skip = new Set(input.skip ?? []);
  const ownerOf = new Map(clients.map((c) => [c.id, c.ownerId]));

  // Money that counts: paid, in, this month, for a client, in a category
  // that earns commission.
  const counted = entries.filter(
    (e) => e.type === "in" && e.status === "paid" && e.clientId !== null && e.date.startsWith(ym) && !skip.has(e.category),
  );

  const rows = new Map<string, CommissionRow>();
  const row = (memberId: string) => {
    let r = rows.get(memberId);
    if (!r) {
      r = { memberId, autoPaise: 0, autoBasePaise: 0, rulePaise: 0, totalPaise: 0, lines: [] };
      rows.set(memberId, r);
    }
    return r;
  };

  // ── automatic: grouped by member and by the rate each payment earned at
  const groups = new Map<string, { memberId: string; bps: number; base: number }>();
  for (const e of counted) {
    const owner = ownerOf.get(e.clientId!);
    if (!owner) continue;
    const bps = rateOn(rates, owner, e.date);
    if (bps <= 0) continue;
    const key = `${owner}:${bps}`;
    const g = groups.get(key) ?? { memberId: owner, bps, base: 0 };
    g.base += e.amountPaise;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const amount = share(g.base, g.bps);
    const r = row(g.memberId);
    r.autoPaise += amount;
    r.autoBasePaise += g.base;
    r.lines.push({ kind: "auto", basePaise: g.base, bps: g.bps, amountPaise: amount });
  }

  // ── by hand
  for (const rule of rules) {
    if (!ruleApplies(rule, ym)) continue;
    let amount = 0;
    let basePaise: number | undefined;
    if (rule.kind === "fixed") {
      amount = rule.amountPaise;
    } else if (rule.clientId) {
      basePaise = counted.filter((e) => e.clientId === rule.clientId).reduce((a, e) => a + e.amountPaise, 0);
      amount = share(basePaise, rule.bps);
    }
    const r = row(rule.memberId);
    r.rulePaise += amount;
    r.lines.push({
      kind: "rule",
      ruleId: rule.id,
      clientId: rule.clientId,
      basePaise,
      bps: rule.kind === "percent" ? rule.bps : undefined,
      amountPaise: amount,
      note: rule.note,
    });
  }

  for (const r of rows.values()) r.totalPaise = r.autoPaise + r.rulePaise;
  return rows;
}

/** "10%", "7.5%" - a basis-point rate as a person reads it. */
export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
