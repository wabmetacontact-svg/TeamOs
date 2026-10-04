/**
 * Ads to revenue, per person, for a month.
 *
 *   spend    what was spent on ads for them that month (entered by hand)
 *   leads    the leads those ads brought (entered by hand)
 *   sales    the clients they brought in who joined that month (counted)
 *   revenue  what those new clients paid that month (counted)
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

export type AdSpendInput = { memberId: string; /** yyyy-MM */ month: string; amountPaise: number; leads: number };

export type FunnelRow = {
  memberId: string;
  spendPaise: number;
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
  ym: string;
  spends: AdSpendInput[];
  clients: { id: string; ownerId: string | null; sinceDate: string | null }[];
  entries: { type: "in" | "out"; status: "paid" | "pending"; clientId: string | null; date: string; amountPaise: number }[];
}): FunnelRow[] {
  const { ym, spends, clients, entries } = input;
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
    if (s.month !== ym) continue;
    const r = row(s.memberId);
    r.spendPaise += s.amountPaise;
    r.leads += s.leads;
  }

  // A sale is a client credited to the person who joined in this month.
  const newClient = new Map<string, string>();
  for (const c of clients) {
    if (!c.ownerId || !c.sinceDate?.startsWith(ym)) continue;
    newClient.set(c.id, c.ownerId);
    row(c.ownerId).sales += 1;
  }

  for (const e of entries) {
    if (e.type !== "in" || e.status !== "paid" || !e.clientId || !e.date.startsWith(ym)) continue;
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
