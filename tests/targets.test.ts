/** Targets against what was achieved: what counts, for whom, and over which days. */
import { describe, expect, test } from "vitest";
import { targetRows, weekOf, type TargetInput } from "../src/lib/targets";

const t = (x: Partial<TargetInput>): TargetInput => ({ memberId: null, sales: null, amountPaise: null, dailySales: null, dailyAmountPaise: null, ...x });

// October 2026: 31 days. The 14th is a Wednesday.
const ym = "2026-10";
const today = "2026-10-14";
const clients = [
  { id: "c1", ownerId: "anil", onboarderId: "neha", sinceDate: "2026-10-02" },
  { id: "c2", ownerId: "anil", onboarderId: null, sinceDate: "2026-10-13" },
  { id: "c3", ownerId: "akash", onboarderId: "neha", sinceDate: "2026-10-14" },
  { id: "old", ownerId: "anil", onboarderId: null, sinceDate: "2026-08-01" },
];
const entries = [
  { type: "in" as const, status: "paid" as const, clientId: "c1", date: "2026-10-02", amountPaise: 1_000_000 },
  { type: "in" as const, status: "paid" as const, clientId: "c3", date: "2026-10-14", amountPaise: 500_000 },
  // A renewal from an old client is money received this month.
  { type: "in" as const, status: "paid" as const, clientId: "old", date: "2026-10-12", amountPaise: 200_000 },
  // Not counted: pending, an expense, last month, no client.
  { type: "in" as const, status: "pending" as const, clientId: "c2", date: "2026-10-13", amountPaise: 9_999_900 },
  { type: "out" as const, status: "paid" as const, clientId: "c2", date: "2026-10-13", amountPaise: 9_999_900 },
  { type: "in" as const, status: "paid" as const, clientId: "c1", date: "2026-09-30", amountPaise: 9_999_900 },
  { type: "in" as const, status: "paid" as const, clientId: null, date: "2026-10-05", amountPaise: 9_999_900 },
];

const rows = (targets: TargetInput[], day = today) => targetRows({ ym, today: day, targets, clients, entries });

describe("the week", () => {
  test("runs Monday to Sunday", () => {
    expect(weekOf("2026-10-14")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
  test("is cut to the month at either end", () => {
    expect(weekOf("2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-04" });
    expect(weekOf("2026-10-30")).toEqual({ from: "2026-10-26", to: "2026-10-31" });
  });
});

describe("the team", () => {
  test("is always first, and counts every new client and all money received from clients", () => {
    const [team] = rows([]);
    expect(team!.memberId).toBeNull();
    expect(team!.month.sales).toEqual({ done: 3, target: null, left: null });
    expect(team!.month.amount.done).toBe(1_700_000);
  });

  test("against a target: what is left, and what each remaining day needs", () => {
    const [team] = rows([t({ sales: 30, amountPaise: 50_000_000 })]);
    expect(team!.month.sales).toEqual({ done: 3, target: 30, left: 27 });
    expect(team!.month.amount.left).toBe(48_300_000);
    // 18 days left, the 14th included.
    expect(team!.perDayNeeded!.sales).toBeCloseTo(27 / 18);
    expect(team!.perDayNeeded!.amountPaise).toBe(Math.ceil(48_300_000 / 18));
  });

  test("this week and today", () => {
    const [team] = rows([t({ sales: 31 })]);
    // 12th-18th: c2 on the 13th, c3 on the 14th.
    expect(team!.week!.sales.done).toBe(2);
    expect(team!.today!.sales.done).toBe(1);
    expect(team!.week!.amount.done).toBe(700_000);
    // No per-day figure: the month's 31 spread over 31 days.
    expect(team!.week!.sales.target).toBe(7);
    expect(team!.today!.sales.target).toBe(1);
    expect(team!.week!.prorated).toBe(true);
  });

  test("a met target has nothing left", () => {
    const [team] = rows([t({ sales: 2 })]);
    expect(team!.month.sales.left).toBe(0);
  });
});

describe("one person", () => {
  test("counts the clients they sold or are onboarding", () => {
    const r = rows([t({ memberId: "anil", sales: 10 }), t({ memberId: "neha", sales: 5 })]);
    const anil = r.find((x) => x.memberId === "anil")!;
    const neha = r.find((x) => x.memberId === "neha")!;
    expect(anil.month.sales.done).toBe(2);
    expect(anil.month.amount.done).toBe(1_200_000);
    expect(neha.month.sales.done).toBe(2);
    expect(neha.month.amount.done).toBe(1_500_000);
  });

  test("a per-day target sets the week and today, and the month when it has none", () => {
    const [, akash] = rows([t({ memberId: "akash", dailySales: 1, dailyAmountPaise: 100_000 })]);
    expect(akash!.month.sales.target).toBe(31);
    expect(akash!.week!.sales.target).toBe(7);
    expect(akash!.today!.sales).toEqual({ done: 1, target: 1, left: 0 });
    expect(akash!.today!.amount).toEqual({ done: 500_000, target: 100_000, left: 0 });
    expect(akash!.week!.prorated).toBe(false);
  });
});

describe("another month", () => {
  test("has no week, no today and nothing per day", () => {
    const [team] = rows([t({ sales: 30 })], "2026-11-03");
    expect(team!.week).toBeNull();
    expect(team!.today).toBeNull();
    expect(team!.perDayNeeded).toBeNull();
    expect(team!.month.sales.done).toBe(3);
  });
});
