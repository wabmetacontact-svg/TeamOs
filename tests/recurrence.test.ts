import { describe, expect, test } from "vitest";
import { nextOccurrence, occurrencesThrough, occurs, ruleText, type Rule } from "../src/lib/recurrence";

const rule = (r: Partial<Rule>): Rule => ({ freq: "daily", weekday: null, everyDays: 1, time: null, start: "2026-09-28", until: null, ...r });

describe("recurring tasks", () => {
  test("weekdays skip Saturday and Sunday", () => {
    // 2026-10-03 is a Saturday.
    const r = rule({ freq: "weekdays" });
    expect(occurs(r, "2026-10-02")).toBe(true);
    expect(occurs(r, "2026-10-03")).toBe(false);
    expect(occurs(r, "2026-10-04")).toBe(false);
    expect(nextOccurrence(r, "2026-10-03")).toBe("2026-10-05");
  });

  test("weekly falls on its weekday", () => {
    const r = rule({ freq: "weekly", weekday: 3 });
    expect(occurrencesThrough(r, "2026-10-14")).toEqual(["2026-09-30", "2026-10-07", "2026-10-14"]);
  });

  test("every N days counts from the start", () => {
    const r = rule({ freq: "every", everyDays: 3 });
    expect(occurrencesThrough(r, "2026-10-07")).toEqual(["2026-09-28", "2026-10-01", "2026-10-04", "2026-10-07"]);
  });

  test("nothing before the start or after the end", () => {
    const r = rule({ until: "2026-09-30" });
    expect(occurs(r, "2026-09-27")).toBe(false);
    expect(occurrencesThrough(r, "2026-10-10")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(nextOccurrence(r, "2026-10-01")).toBeNull();
  });

  test("reads as words", () => {
    expect(ruleText(rule({ freq: "weekly", weekday: 1, time: "09:30", until: "2026-12-31" }))).toBe("Every Monday at 09:30, until 31 Dec");
  });
});
