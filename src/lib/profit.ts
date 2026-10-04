/**
 * A month's profit, opened up.
 *
 * The figure before anything owed is exactly the Net on the Income and
 * expenses screen - same entries, same month rule - only broken down, so the
 * two can never show different profits for the same month. The caller passes
 * the month's entries already chosen by that rule.
 *
 * "Still owed" is what has not reached the ledger at all yet: salaries with no
 * entry this month, and commission earned but not paid. Neither can already be
 * in the Net, so subtracting them counts nothing twice. Either is null when the
 * viewer has no Payroll access - unknown, which is not the same as zero.
 */

/** Team costs first, in this order; every other category after, largest first. */
export const TEAM_COSTS = ["Salaries", "Commissions", "Ads"] as const;

export type ProfitLine = { category: string; paise: number };

export type Profit = {
  incomePaise: number;
  expenses: ProfitLine[];
  expensePaise: number;
  /** Equal to the Net card. */
  netPaise: number;
  owedSalaryPaise: number | null;
  owedCommissionPaise: number | null;
  /** Net less everything still owed, or null when what is owed is not known. */
  afterOwedPaise: number | null;
};

export function profitFor(input: {
  entries: { type: "in" | "out"; category: string; amountPaise: number }[];
  owedSalaryPaise: number | null;
  owedCommissionPaise: number | null;
}): Profit {
  const { entries, owedSalaryPaise, owedCommissionPaise } = input;
  const incomePaise = entries.filter((e) => e.type === "in").reduce((a, e) => a + e.amountPaise, 0);

  const byCategory = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "out") continue;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountPaise);
  }
  const team = TEAM_COSTS.filter((c) => byCategory.has(c)).map((c) => ({ category: c, paise: byCategory.get(c)! }));
  const rest = [...byCategory.entries()]
    .filter(([c]) => !(TEAM_COSTS as readonly string[]).includes(c))
    .map(([category, paise]) => ({ category, paise }))
    .sort((a, b) => b.paise - a.paise);
  const expenses = [...team, ...rest];
  const expensePaise = expenses.reduce((a, l) => a + l.paise, 0);
  const netPaise = incomePaise - expensePaise;

  const known = owedSalaryPaise !== null && owedCommissionPaise !== null;
  return {
    incomePaise,
    expenses,
    expensePaise,
    netPaise,
    owedSalaryPaise,
    owedCommissionPaise,
    afterOwedPaise: known ? netPaise - owedSalaryPaise! - owedCommissionPaise! : null,
  };
}
