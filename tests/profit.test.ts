/** A month's profit, opened up. No database. */
import { describe, expect, test } from "vitest";
import { profitFor } from "../src/lib/profit";

const e = (type: "in" | "out", category: string, amountPaise: number) => ({ type, category, amountPaise });

describe("profit", () => {
  const entries = [
    e("in", "WabMeta plan", 1_000_000),
    e("in", "WabMeta offline", 200_000),
    e("out", "Rent", 300_000),
    e("out", "Salaries", 400_000),
    e("out", "Ads", 100_000),
    e("out", "Commissions", 50_000),
    e("out", "Software", 20_000),
  ];

  test("is income less every expense - the same figure as Net", () => {
    const p = profitFor({ entries, owedSalaryPaise: 0, owedCommissionPaise: 0 });
    expect(p.incomePaise).toBe(1_200_000);
    expect(p.expensePaise).toBe(870_000);
    expect(p.netPaise).toBe(330_000);
  });

  test("lists team costs first, then the rest largest first", () => {
    const p = profitFor({ entries, owedSalaryPaise: 0, owedCommissionPaise: 0 });
    expect(p.expenses.map((l) => l.category)).toEqual(["Salaries", "Commissions", "Ads", "Rent", "Software"]);
  });

  test("takes off what is still owed, to give the profit after it", () => {
    const p = profitFor({ entries, owedSalaryPaise: 150_000, owedCommissionPaise: 30_000 });
    expect(p.afterOwedPaise).toBe(330_000 - 180_000);
  });

  test("says it does not know, rather than pretending nothing is owed", () => {
    // Without Payroll access the salaries owed are unknown. Showing the Net as
    // the profit after them would overstate it by every unpaid salary.
    const p = profitFor({ entries, owedSalaryPaise: null, owedCommissionPaise: null });
    expect(p.afterOwedPaise).toBeNull();
    expect(p.netPaise).toBe(330_000);
  });

  test("a loss is a negative profit", () => {
    const p = profitFor({ entries: [e("in", "x", 100), e("out", "Rent", 500)], owedSalaryPaise: 0, owedCommissionPaise: 0 });
    expect(p.netPaise).toBe(-400);
  });
});
