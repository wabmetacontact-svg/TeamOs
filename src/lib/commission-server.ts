import "server-only";
import { commissionsFor, type CommissionRow } from "./commission";
import { daysInMonth } from "./format";
import type { Tx } from "./mutate";
import { dateOnly, toDate } from "./workspace";

/**
 * The server side of commission: the paid figure.
 *
 * Kept out of the actions file on purpose. Every async function exported from
 * a "use server" file becomes something the browser can call, and this one
 * takes a transaction and reads every client's money.
 */

export const monthRange = (ym: string) => ({
  from: toDate(`${ym}-01`),
  to: toDate(`${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`),
});

/**
 * One member's commission for a month, worked out from everything in the
 * workspace - not from what the person paying happens to be allowed to see.
 * The screen shows the same function's answer over the browser's data; this
 * is the one that is paid.
 */
export async function commissionRowFor(tx: Tx, ym: string, memberId: string): Promise<CommissionRow | undefined> {
  const { from, to } = monthRange(ym);
  const [clients, entries, rates, rules, tenant] = await Promise.all([
    tx.client.findMany({ select: { id: true, ownerMemberId: true } }),
    tx.ledgerEntry.findMany({
      where: { type: "in", status: "paid", clientId: { not: null }, date: { gte: from, lte: to } },
      select: { type: true, status: true, clientId: true, date: true, category: true, amount: true },
    }),
    tx.commissionRate.findMany({ where: { memberId } }),
    tx.commissionRule.findMany({ where: { memberId } }),
    tx.tenant.findFirstOrThrow({ select: { commissionSkip: true } }),
  ]);

  return commissionsFor({
    ym,
    clients: clients.map((c) => ({ id: c.id, ownerId: c.ownerMemberId })),
    entries: entries.map((e) => ({
      type: "in",
      status: "paid",
      clientId: e.clientId,
      date: dateOnly(e.date)!,
      category: e.category,
      amountPaise: Number(e.amount),
    })),
    rates: rates.map((r) => ({ memberId: r.memberId, from: dateOnly(r.effectiveFrom)!, bps: r.bps })),
    rules: rules.map((r) => ({
      id: r.id,
      memberId: r.memberId,
      clientId: r.clientId,
      kind: r.kind === "percent" ? "percent" : "fixed",
      amountPaise: Number(r.amount),
      bps: r.bps,
      repeat: r.repeat === "monthly" ? "monthly" : "once",
      fromMonth: dateOnly(r.fromMonth)!.slice(0, 7),
      toMonth: r.toMonth ? dateOnly(r.toMonth)!.slice(0, 7) : null,
      note: r.note,
    })),
    skip: tenant.commissionSkip,
  }).get(memberId);
}

