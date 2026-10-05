/** Ads to revenue, per person. No database: arithmetic, and what counts. */
import { describe, expect, test } from "vitest";
import { funnelFor, periodLabel, periodRange } from "../src/lib/ads";

const ym = "2026-10";
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const month = (m: string) => periodRange("month", `${m}-01`);
const paid = (clientId: string, amountPaise: number, date = "2026-10-12") =>
  ({ type: "in" as const, status: "paid" as const, clientId, date, amountPaise });

describe("the funnel", () => {
  const base = {
    ...OCT,
    spends: [
      { memberId: "neha", ...month("2026-10"), amountPaise: 1_000_000, leads: 40 },
      { memberId: "neha", ...month("2026-10"), amountPaise: 500_000, leads: 10 },
      { memberId: "neha", ...month("2026-09"), amountPaise: 9_999_999, leads: 999 },
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
    const r = funnelFor({ ...OCT, spends: [{ memberId: "x", ...month(ym), amountPaise: 100_000, leads: 0 }], clients: [], entries: [] })[0]!;
    expect(r.conversion).toBeNull();
    expect(r.costPerLeadPaise).toBeNull();
    expect(r.costPerSalePaise).toBeNull();
    expect(r.returnOnSpend).toBe(0);
  });

  test("a sale with no ad spend is still a sale, with no cost to divide", () => {
    const r = funnelFor({ ...OCT, spends: [], clients: [{ id: "c", ownerId: "ravi", sinceDate: "2026-10-01" }], entries: [paid("c", 100)] })[0]!;
    expect(r).toMatchObject({ memberId: "ravi", sales: 1, revenuePaise: 100, spendPaise: 0, costPerSalePaise: null, returnOnSpend: null });
  });

  test("pending money and money out are not revenue", () => {
    const r = funnelFor({
      ...OCT,
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

describe("days and weeks", () => {
  test("a week runs Monday to Sunday, and may cross into the next month", () => {
    expect(periodRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", "2026-10-29")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(periodRange("day", "2026-10-07")).toEqual({ from: "2026-10-07", to: "2026-10-07" });
    expect(periodRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("labels", () => {
    expect(periodLabel("day", "2026-10-07")).toBe("7 Oct 2026");
    expect(periodLabel("week", "2026-10-05")).toBe("Week of 5 Oct 2026");
    expect(periodLabel("month", "2026-10-01")).toBe("October 2026");
  });

  const spends = [
    // A day, a week inside October, and a week that runs into November.
    { memberId: "neha", from: "2026-10-07", to: "2026-10-07", amountPaise: 100_000, leads: 5 },
    { memberId: "neha", ...periodRange("week", "2026-10-07"), amountPaise: 700_000, leads: 70 },
    { memberId: "neha", ...periodRange("week", "2026-10-29"), amountPaise: 700_000, leads: 14 },
  ];

  test("a day counts its own spend and a seventh of its week's", () => {
    const r = funnelFor({ from: "2026-10-07", to: "2026-10-07", spends, clients: [], entries: [] })[0]!;
    expect(r.spendPaise).toBe(100_000 + 100_000);
    expect(r.leads).toBeCloseTo(5 + 10);
  });

  test("a week that runs into the next month splits by its days", () => {
    const oct = funnelFor({ ...OCT, spends, clients: [], entries: [] })[0]!;
    // The day, the whole first week, and 6 of the 7 days of the last.
    expect(oct.spendPaise).toBe(100_000 + 700_000 + 600_000);
    const nov = funnelFor({ ...periodRange("month", "2026-11-01"), spends, clients: [], entries: [] })[0]!;
    expect(nov.spendPaise).toBe(100_000);
  });

  test("the weeks of a month add up to the month", () => {
    const monthly = [{ memberId: "neha", ...month("2026-10"), amountPaise: 3_100_000, leads: 310 }];
    const weeks = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) => periodRange("week", d));
    const total = weeks.reduce((a, w) => a + funnelFor({ ...w, spends: monthly, clients: [], entries: [] })[0]!.spendPaise, 0);
    expect(total).toBe(3_100_000);
  });

  test("sales and revenue in a week count only that week", () => {
    const wk = periodRange("week", "2026-10-07");
    const r = funnelFor({
      ...wk,
      spends: [],
      clients: [
        { id: "in", ownerId: "neha", sinceDate: "2026-10-06" },
        { id: "out", ownerId: "neha", sinceDate: "2026-10-20" },
      ],
      entries: [paid("in", 100_000, "2026-10-08"), paid("in", 50_000, "2026-10-15"), paid("out", 9_999, "2026-10-20")],
    })[0]!;
    expect(r.sales).toBe(1);
    expect(r.revenuePaise).toBe(100_000);
  });
});
