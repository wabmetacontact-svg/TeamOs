import { MN, MNF, addDays, dayDiff, daysInMonth, weekday } from "./format";

/**
 * Ads to revenue, per person, for a window of days - a day, a week or a month.
 *
 *   spend    what was spent on ads for them in the window (entered by hand)
 *   leads    the leads those ads brought (entered by hand)
 *   sales    the clients they brought in who joined in the window (counted)
 *   revenue  what those new clients paid in the window (counted)
 *
 * Spend is entered for a day, a week or a month. An entry that covers only
 * part of the window - a month's spend seen one week at a time, or a week that
 * runs into the next month - counts in proportion to the days that overlap,
 * so the weeks of a month add up to the month.
 *
 * Sales and revenue are never typed in. They come from the clients credited to
 * the person and the money in the ledger, so they cannot disagree with the
 * Clients screen or the Sales tab.
 *
 * Revenue here is deliberately the money from that month's NEW clients, not
 * everything the person's clients paid: the question is what the ads bought,
 * and a client won two years ago was not bought by this month's ads.
 *
 * Every ratio is null when its divisor is zero, rather than 0 or Infinity -
 * "cost per sale" for a month with no sales is not a number, and showing 0
 * would read as free.
 */

export type AdSpendInput = {
  memberId: string;
  /** yyyy-MM-dd, the days the entry covers, both ends included. */
  from: string;
  to: string;
  amountPaise: number;
  leads: number;
};

export type FunnelRow = {
  memberId: string;
  spendPaise: number;
  /** May be fractional when an entry is spread over days; round to show. */
  leads: number;
  sales: number;
  revenuePaise: number;
  /** sales / leads */
  conversion: number | null;
  costPerLeadPaise: number | null;
  costPerSalePaise: number | null;
  /** revenue / spend */
  returnOnSpend: number | null;
};

export function funnelFor(input: {
  /** yyyy-MM-dd, both ends included. */
  from: string;
  to: string;
  spends: AdSpendInput[];
  clients: { id: string; ownerId: string | null; sinceDate: string | null }[];
  entries: { type: "in" | "out"; status: "paid" | "pending"; clientId: string | null; date: string; amountPaise: number }[];
}): FunnelRow[] {
  const { from, to, spends, clients, entries } = input;
  const inWindow = (d: string) => d >= from && d <= to;
  const rows = new Map<string, FunnelRow>();
  const row = (memberId: string) => {
    let r = rows.get(memberId);
    if (!r) {
      r = {
        memberId,
        spendPaise: 0,
        leads: 0,
        sales: 0,
        revenuePaise: 0,
        conversion: null,
        costPerLeadPaise: null,
        costPerSalePaise: null,
        returnOnSpend: null,
      };
      rows.set(memberId, r);
    }
    return r;
  };

  for (const s of spends) {
    const share = overlap(s.from, s.to, from, to);
    if (!share) continue;
    const r = row(s.memberId);
    r.spendPaise += s.amountPaise * share;
    r.leads += s.leads * share;
  }
  for (const r of rows.values()) r.spendPaise = Math.round(r.spendPaise);

  // A sale is a client credited to the person who joined in the window.
  const newClient = new Map<string, string>();
  for (const c of clients) {
    if (!c.ownerId || !c.sinceDate || !inWindow(c.sinceDate)) continue;
    newClient.set(c.id, c.ownerId);
    row(c.ownerId).sales += 1;
  }

  for (const e of entries) {
    if (e.type !== "in" || e.status !== "paid" || !e.clientId || !inWindow(e.date)) continue;
    const owner = newClient.get(e.clientId);
    if (owner) row(owner).revenuePaise += e.amountPaise;
  }

  for (const r of rows.values()) {
    r.conversion = r.leads ? r.sales / r.leads : null;
    r.costPerLeadPaise = r.leads && r.spendPaise ? Math.round(r.spendPaise / r.leads) : null;
    r.costPerSalePaise = r.sales && r.spendPaise ? Math.round(r.spendPaise / r.sales) : null;
    r.returnOnSpend = r.spendPaise ? r.revenuePaise / r.spendPaise : null;
  }

  return [...rows.values()].sort((a, b) => b.revenuePaise - a.revenuePaise || b.sales - a.sales || b.spendPaise - a.spendPaise);
}

/** The share of an entry's days [a, b] that fall inside [from, to]: 0 to 1. */
function overlap(a: string, b: string, from: string, to: string): number {
  const start = a > from ? a : from;
  const end = b < to ? b : to;
  if (end < start) return 0;
  return (dayDiff(end, start) + 1) / (dayDiff(b, a) + 1);
}

export type Period = "day" | "week" | "month";

/** The days a period starting from any day in it covers: a day, Monday to Sunday, or the calendar month. */
export function periodRange(period: Period, day: string): { from: string; to: string } {
  if (period === "day") return { from: day, to: day };
  if (period === "week") {
    const from = addDays(day, -((weekday(day) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const ym = day.slice(0, 7);
  return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}` };
}

/** "6 Oct 2026", "Week of 5 Oct 2026", "October 2026". */
export function periodLabel(period: Period, from: string): string {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  if (period === "month") return `${MNF[m - 1]} ${y}`;
  const day = `${d} ${MN[m - 1]} ${y}`;
  return period === "week" ? `Week of ${day}` : day;
}
