import { addDays, dayDiff, daysInMonth, weekday } from "./format";

/**
 * Targets against what was achieved, for the month, this week and today.
 *
 * Only targets are typed in. What was achieved is counted, never entered:
 *
 *   sales   clients who joined in the window (their "since" date, which WabMeta
 *           sets to the sale, else the onboarding, else when they signed up)
 *   amount  money actually received in the window from clients - paid incoming
 *           ledger entries, which is where WabMeta's payments land
 *
 * For a person, "their" clients are the ones they sold or are onboarding, so a
 * target set on an onboarder counts what they onboarded. The team counts every
 * client once - which is why the team's figure is not the people's figures
 * added up: a client sold by one person and onboarded by another counts for
 * both of them, and once for the team.
 *
 * The week and today have a target only from a per-day figure, or, without one,
 * the month's target spread evenly over its days. The second is marked
 * `prorated` so the screen can say so.
 *
 * All money here is in paise.
 */

export type TargetInput = {
  memberId: string | null;
  sales: number | null;
  amountPaise: number | null;
  dailySales: number | null;
  dailyAmountPaise: number | null;
};

export type Measure = {
  done: number;
  target: number | null;
  /** What is still to do; 0 once the target is met, null without a target. */
  left: number | null;
};

export type Period = {
  /** yyyy-MM-dd, inclusive. */
  from: string;
  to: string;
  sales: Measure;
  amount: Measure;
  /** True when the target is the month's spread over its days, not a per-day figure. */
  prorated: boolean;
};

export type TargetRow = {
  /** null is the whole team. */
  memberId: string | null;
  month: Period;
  /** Only while the month is the current one. */
  week: Period | null;
  today: Period | null;
  /** What each remaining day, today included, needs to reach the month's target. */
  perDayNeeded: { sales: number | null; amountPaise: number | null } | null;
};

type ClientIn = { id: string; ownerId: string | null; onboarderId: string | null; sinceDate: string | null };
type EntryIn = { type: "in" | "out"; status: "paid" | "pending"; clientId: string | null; date: string; amountPaise: number };

const measure = (done: number, target: number | null): Measure => ({
  done,
  target,
  left: target === null ? null : Math.max(0, target - done),
});

/** The Monday-to-Sunday week holding `day`, cut to the month it is in. */
export function weekOf(day: string): { from: string; to: string } {
  const ym = day.slice(0, 7);
  const monday = addDays(day, -((weekday(day) + 6) % 7));
  const sunday = addDays(monday, 6);
  const first = `${ym}-01`;
  const last = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
  return { from: monday < first ? first : monday, to: sunday > last ? last : sunday };
}

export function targetRows(input: {
  /** yyyy-MM being shown. */
  ym: string;
  /** yyyy-MM-dd in the workspace's time zone. */
  today: string;
  targets: TargetInput[];
  clients: ClientIn[];
  entries: EntryIn[];
}): TargetRow[] {
  const { ym, today, targets, clients, entries } = input;
  const days = daysInMonth(ym);
  const monthFrom = `${ym}-01`;
  const monthTo = `${ym}-${String(days).padStart(2, "0")}`;
  const current = today.slice(0, 7) === ym;

  const paid = entries.filter((e) => e.type === "in" && e.status === "paid" && e.clientId !== null);

  const rows: TargetRow[] = [];
  // The team first, whether or not it has a target, then each person who has one.
  const ordered = [targets.find((t) => t.memberId === null) ?? emptyTarget(null), ...targets.filter((t) => t.memberId !== null)];

  for (const t of ordered) {
    const mine = t.memberId === null ? clients : clients.filter((c) => c.ownerId === t.memberId || c.onboarderId === t.memberId);
    const ids = new Set(mine.map((c) => c.id));

    const count = (from: string, to: string) => {
      const sales = mine.filter((c) => c.sinceDate !== null && c.sinceDate >= from && c.sinceDate <= to).length;
      const amount = paid.filter((e) => ids.has(e.clientId!) && e.date >= from && e.date <= to).reduce((a, e) => a + e.amountPaise, 0);
      return { sales, amount };
    };

    // The month's target, or, with only a per-day figure, that figure times the days.
    const monthSales = t.sales ?? (t.dailySales === null ? null : t.dailySales * days);
    const monthAmount = t.amountPaise ?? (t.dailyAmountPaise === null ? null : t.dailyAmountPaise * days);

    const period = (from: string, to: string): Period => {
      const n = dayDiff(to, from) + 1;
      const done = count(from, to);
      const whole = from === monthFrom && to === monthTo;
      const salesTarget = whole ? monthSales : t.dailySales !== null ? t.dailySales * n : spread(monthSales, n, days);
      const amountTarget = whole ? monthAmount : t.dailyAmountPaise !== null ? t.dailyAmountPaise * n : spread(monthAmount, n, days);
      return {
        from,
        to,
        sales: measure(done.sales, salesTarget),
        amount: measure(done.amount, amountTarget),
        prorated: !whole && ((t.dailySales === null && monthSales !== null) || (t.dailyAmountPaise === null && monthAmount !== null)),
      };
    };

    const month = period(monthFrom, monthTo);
    let week: Period | null = null;
    let todayP: Period | null = null;
    let perDayNeeded: TargetRow["perDayNeeded"] = null;
    if (current) {
      const wk = weekOf(today);
      week = period(wk.from, wk.to);
      todayP = period(today, today);
      // Days left including today: what is still to do, spread over them.
      const remaining = dayDiff(monthTo, today) + 1;
      perDayNeeded = {
        sales: month.sales.left === null ? null : month.sales.left / remaining,
        amountPaise: month.amount.left === null ? null : Math.ceil(month.amount.left / remaining),
      };
    }

    rows.push({ memberId: t.memberId, month, week, today: todayP, perDayNeeded });
  }

  return rows;
}

const emptyTarget = (memberId: string | null): TargetInput => ({ memberId, sales: null, amountPaise: null, dailySales: null, dailyAmountPaise: null });

/** A month's target spread over `n` of its `days`, rounded up - a target of 0.3 sales is still a sale. */
const spread = (monthly: number | null, n: number, days: number) => (monthly === null ? null : Math.ceil((monthly * n) / days));
