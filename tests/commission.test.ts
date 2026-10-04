/**
 * Commission arithmetic. No database: this is the number people are paid, so
 * every rule in src/lib/commission.ts has a case here.
 */
import { describe, expect, test } from "vitest";
import { commissionsFor, pct, rateOn, ruleApplies, type CommissionEntry, type CommissionRuleInput } from "../src/lib/commission";

const pay = (clientId: string | null, amountPaise: number, over: Partial<CommissionEntry> = {}): CommissionEntry => ({
  type: "in",
  status: "paid",
  clientId,
  date: "2026-10-10",
  category: "WabMeta plan",
  amountPaise,
  ...over,
});

const rule = (over: Partial<CommissionRuleInput>): CommissionRuleInput => ({
  id: `r-${Math.random()}`,
  memberId: "neha",
  clientId: null,
  kind: "fixed",
  amountPaise: 0,
  bps: 0,
  repeat: "once",
  fromMonth: "2026-10",
  toMonth: null,
  note: "",
  ...over,
});

const clients = [
  { id: "c1", ownerId: "ravi" },
  { id: "c2", ownerId: "ravi" },
  { id: "c3", ownerId: null },
];
const tenPct = [{ memberId: "ravi", from: "2026-01-01", bps: 1000 }];

describe("the automatic commission", () => {
  test("is the rate on what the member's own clients paid", () => {
    const rows = commissionsFor({ ym: "2026-10", clients, rates: tenPct, rules: [], entries: [pay("c1", 179_900), pay("c2", 50_000)] });
    const r = rows.get("ravi")!;
    expect(r.autoBasePaise).toBe(229_900);
    expect(r.autoPaise).toBe(22_990);
    expect(r.totalPaise).toBe(22_990);
  });

  test("counts only money received - not pending, not money going out", () => {
    const rows = commissionsFor({
      ym: "2026-10",
      clients,
      rates: tenPct,
      rules: [],
      entries: [pay("c1", 100_000), pay("c1", 900_000, { status: "pending" }), pay("c1", 500_000, { type: "out" })],
    });
    expect(rows.get("ravi")!.autoBasePaise).toBe(100_000);
  });

  test("counts only the month asked about", () => {
    const rows = commissionsFor({
      ym: "2026-10",
      clients,
      rates: tenPct,
      rules: [],
      entries: [pay("c1", 100_000), pay("c1", 300_000, { date: "2026-09-30" })],
    });
    expect(rows.get("ravi")!.autoBasePaise).toBe(100_000);
  });

  test("a client credited to nobody earns nobody anything", () => {
    const rows = commissionsFor({ ym: "2026-10", clients, rates: tenPct, rules: [], entries: [pay("c3", 1_000_000)] });
    expect(rows.size).toBe(0);
  });

  test("a member with no rate gets no automatic commission", () => {
    const rows = commissionsFor({ ym: "2026-10", clients, rates: [], rules: [], entries: [pay("c1", 1_000_000)] });
    expect(rows.size).toBe(0);
  });

  test("skipped categories earn nothing - e.g. wallet top-ups", () => {
    const rows = commissionsFor({
      ym: "2026-10",
      clients,
      rates: tenPct,
      rules: [],
      skip: ["WabMeta wallet"],
      entries: [pay("c1", 100_000), pay("c1", 5_000_000, { category: "WabMeta wallet" })],
    });
    expect(rows.get("ravi")!.autoBasePaise).toBe(100_000);
  });

  test("a rate change applies from its date, and earlier money keeps the old rate", () => {
    // 10% until the 15th, 20% from then. Changing the rate must not rewrite
    // what was already earned at the old one.
    const rates = [...tenPct, { memberId: "ravi", from: "2026-10-15", bps: 2000 }];
    const rows = commissionsFor({
      ym: "2026-10",
      clients,
      rates,
      rules: [],
      entries: [pay("c1", 100_000, { date: "2026-10-10" }), pay("c1", 100_000, { date: "2026-10-20" })],
    });
    expect(rows.get("ravi")!.autoPaise).toBe(10_000 + 20_000);
    expect(rows.get("ravi")!.lines.filter((l) => l.kind === "auto")).toHaveLength(2);
  });

  test("rounds once per rate, not once per payment", () => {
    // Three payments of 5 paise at 10%: per-payment rounding would give 3 x 1 =
    // 3 paise (or 0); the honest answer for 15 paise at 10% is 2.
    const rows = commissionsFor({ ym: "2026-10", clients, rates: tenPct, rules: [], entries: [pay("c1", 5), pay("c1", 5), pay("c1", 5)] });
    expect(rows.get("ravi")!.autoPaise).toBe(2);
  });
});

describe("commission given by hand", () => {
  test("a fixed amount, once, counts in its month only", () => {
    const r = rule({ kind: "fixed", amountPaise: 50_000, fromMonth: "2026-10" });
    expect(commissionsFor({ ym: "2026-10", clients, rates: [], rules: [r], entries: [] }).get("neha")!.totalPaise).toBe(50_000);
    expect(commissionsFor({ ym: "2026-11", clients, rates: [], rules: [r], entries: [] }).get("neha")).toBeUndefined();
  });

  test("a fixed amount every month runs until its end month", () => {
    const r = rule({ kind: "fixed", amountPaise: 10_000, repeat: "monthly", fromMonth: "2026-09", toMonth: "2026-11" });
    for (const [ym, expected] of [["2026-08", undefined], ["2026-09", 10_000], ["2026-11", 10_000], ["2026-12", undefined]] as const) {
      expect(commissionsFor({ ym, clients, rates: [], rules: [r], entries: [] }).get("neha")?.totalPaise).toBe(expected);
    }
  });

  test("a share of one client's money, for somebody who did not bring it in", () => {
    // Neha onboarded Ravi's client and gets 5% of what it pays. Ravi still gets
    // his own 10% - a commission by hand is added, never taken from someone.
    const r = rule({ kind: "percent", bps: 500, clientId: "c1", repeat: "monthly" });
    const rows = commissionsFor({ ym: "2026-10", clients, rates: tenPct, rules: [r], entries: [pay("c1", 200_000)] });
    expect(rows.get("neha")!.totalPaise).toBe(10_000);
    expect(rows.get("ravi")!.totalPaise).toBe(20_000);
  });

  test("a share respects the same rules about what counts", () => {
    const r = rule({ kind: "percent", bps: 1000, clientId: "c1", repeat: "monthly" });
    const rows = commissionsFor({
      ym: "2026-10",
      clients,
      rates: [],
      rules: [r],
      skip: ["WabMeta wallet"],
      entries: [pay("c1", 100_000), pay("c1", 100_000, { status: "pending" }), pay("c1", 100_000, { category: "WabMeta wallet" })],
    });
    expect(rows.get("neha")!.totalPaise).toBe(10_000);
  });

  test("adds to the automatic commission for the same person", () => {
    const bonus = rule({ memberId: "ravi", kind: "fixed", amountPaise: 25_000 });
    const row = commissionsFor({ ym: "2026-10", clients, rates: tenPct, rules: [bonus], entries: [pay("c1", 100_000)] }).get("ravi")!;
    expect(row.autoPaise).toBe(10_000);
    expect(row.rulePaise).toBe(25_000);
    expect(row.totalPaise).toBe(35_000);
  });
});

describe("helpers", () => {
  test("the rate on a day is the latest one that had begun", () => {
    const rates = [
      { memberId: "ravi", from: "2026-01-01", bps: 1000 },
      { memberId: "ravi", from: "2026-06-01", bps: 1500 },
      { memberId: "neha", from: "2026-01-01", bps: 9999 },
    ];
    expect(rateOn(rates, "ravi", "2025-12-31")).toBe(0);
    expect(rateOn(rates, "ravi", "2026-05-31")).toBe(1000);
    expect(rateOn(rates, "ravi", "2026-06-01")).toBe(1500);
  });

  test("a once rule applies in one month, an open monthly one from its start on", () => {
    expect(ruleApplies({ repeat: "once", fromMonth: "2026-10", toMonth: null }, "2026-10")).toBe(true);
    expect(ruleApplies({ repeat: "once", fromMonth: "2026-10", toMonth: null }, "2026-11")).toBe(false);
    expect(ruleApplies({ repeat: "monthly", fromMonth: "2026-10", toMonth: null }, "2027-04")).toBe(true);
  });

  test("rates read the way people write them", () => {
    expect(pct(1000)).toBe("10%");
    expect(pct(750)).toBe("7.5%");
    expect(pct(1250)).toBe("12.5%");
    expect(pct(5)).toBe("0.05%");
  });
});
