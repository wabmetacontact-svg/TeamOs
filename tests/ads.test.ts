/** Ads to revenue, per person. No database: arithmetic, and what counts. */
import { describe, expect, test } from "vitest";
import { funnelFor } from "../src/lib/ads";

const ym = "2026-10";
const paid = (clientId: string, amountPaise: number, date = "2026-10-12") =>
  ({ type: "in" as const, status: "paid" as const, clientId, date, amountPaise });

describe("the funnel", () => {
  const base = {
    ym,
    spends: [
      { memberId: "neha", month: "2026-10", amountPaise: 1_000_000, leads: 40 },
      { memberId: "neha", month: "2026-10", amountPaise: 500_000, leads: 10 },
      { memberId: "neha", month: "2026-09", amountPaise: 9_999_999, leads: 999 },
    ],
    clients: [
      { id: "new1", ownerId: "neha", sinceDate: "2026-10-03" },
      { id: "new2", ownerId: "neha", sinceDate: "2026-10-20" },
      { id: "old", ownerId: "neha", sinceDate: "2025-01-10" },
    ],
    entries: [paid("new1", 179_900), paid("new2", 299_900), paid("old", 500_000)],
  };

  test("adds up a month's spend and leads, and only that month's", () => {
    const n = funnelFor(base).find((r) => r.memberId === "neha")!;
    expect(n.spendPaise).toBe(1_500_000);
    expect(n.leads).toBe(50);
  });

  test("counts sales as their clients who joined that month", () => {
    expect(funnelFor(base).find((r) => r.memberId === "neha")!.sales).toBe(2);
  });

  test("counts revenue from those new clients only, not from clients won before", () => {
    // What did this month's ads buy? Not the client from 2025.
    expect(funnelFor(base).find((r) => r.memberId === "neha")!.revenuePaise).toBe(479_800);
  });

  test("works out conversion, cost per lead, cost per sale and return", () => {
    const n = funnelFor(base).find((r) => r.memberId === "neha")!;
    expect(n.conversion).toBeCloseTo(2 / 50);
    expect(n.costPerLeadPaise).toBe(30_000);
    expect(n.costPerSalePaise).toBe(750_000);
    expect(n.returnOnSpend).toBeCloseTo(479_800 / 1_500_000);
  });

  test("a ratio with nothing to divide by is unknown, not zero", () => {
    // No sales: cost per sale is not ₹0, it does not exist.
    const r = funnelFor({ ym, spends: [{ memberId: "x", month: ym, amountPaise: 100_000, leads: 0 }], clients: [], entries: [] })[0]!;
    expect(r.conversion).toBeNull();
    expect(r.costPerLeadPaise).toBeNull();
    expect(r.costPerSalePaise).toBeNull();
    expect(r.returnOnSpend).toBe(0);
  });

  test("a sale with no ad spend is still a sale, with no cost to divide", () => {
    const r = funnelFor({ ym, spends: [], clients: [{ id: "c", ownerId: "ravi", sinceDate: "2026-10-01" }], entries: [paid("c", 100)] })[0]!;
    expect(r).toMatchObject({ memberId: "ravi", sales: 1, revenuePaise: 100, spendPaise: 0, costPerSalePaise: null, returnOnSpend: null });
  });

  test("pending money and money out are not revenue", () => {
    const r = funnelFor({
      ym,
      spends: [],
      clients: [{ id: "c", ownerId: "ravi", sinceDate: "2026-10-01" }],
      entries: [
        { type: "in", status: "pending", clientId: "c", date: "2026-10-05", amountPaise: 1_000 },
        { type: "out", status: "paid", clientId: "c", date: "2026-10-05", amountPaise: 1_000 },
      ],
    })[0]!;
    expect(r.revenuePaise).toBe(0);
  });
});
