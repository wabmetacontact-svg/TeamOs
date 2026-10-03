/**
 * Reading spreadsheets. The same checks run in the browser for the preview and
 * on the server before anything is written, so they are tested once.
 */
import { describe, expect, test } from "vitest";
import { autoMap, checkRows, parseCSV, toISO, toNum, type ImportData, type LedgerRec, type TaskRec } from "../src/lib/importer";

const data: ImportData = {
  meId: "me",
  today: "2026-10-03",
  team: [
    { id: "p1", name: "Asha Rao", email: "asha@co.in" },
    { id: "p2", name: "Vikram Shah", email: null },
  ],
  clients: [{ id: "c1", name: "Northwind", company: "Northwind Foods Pvt Ltd", brandId: "b1" }],
  brands: [{ id: "b1", name: "Agency One" }],
};

describe("parsing", () => {
  test("commas, quotes, doubled quotes and a byte-order mark", () => {
    const rows = parseCSV('﻿Name,Note\n"Rao, Asha","She said ""hi"""\n');
    expect(rows).toEqual([
      ["Name", "Note"],
      ["Rao, Asha", 'She said "hi"'],
    ]);
  });

  test("tabs when the header uses tabs, which is what pasting from a sheet gives", () => {
    expect(parseCSV("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("blank lines are dropped", () => {
    expect(parseCSV("a,b\n\n1,2\n,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("dates in the shapes spreadsheets produce", () => {
    expect(toISO("2026-09-05")).toBe("2026-09-05");
    expect(toISO("05/09/2026")).toBe("2026-09-05");
    expect(toISO("5-9-26")).toBe("2026-09-05");
    // Month first only when day-first is impossible.
    expect(toISO("09/25/2026")).toBe("2026-09-25");
    expect(toISO("")).toBe("");
    expect(toISO("someday")).toBeNull();
  });

  test("amounts with currency marks, grouping and accounting brackets", () => {
    expect(toNum("₹1,20,000")).toBe(120000);
    expect(toNum("1,000 USD")).toBe(1000);
    expect(toNum("(500)")).toBe(-500);
    expect(toNum("")).toBeNull();
    expect(toNum("lots")).toBeNaN();
  });

  test("columns match by name", () => {
    expect(autoMap("ledger", ["Txn Date", "Particulars", "Amount INR", "Type"])).toMatchObject({ date: "0", desc: "1", amount: "2", type: "3" });
  });
});

describe("checking", () => {
  test("a task row resolves people and clients by name, email or first name", () => {
    const [row] = checkRows("tasks", [["Write brief", "asha", "Northwind Foods Pvt Ltd", "Done", "2026-09-30"]], { title: "0", who: "1", client: "2", status: "3", due: "4" }, { mkClients: false, mkMembers: false }, data);
    expect(row!.ok).toBe(true);
    const rec = row!.rec as TaskRec;
    expect(rec).toMatchObject({ who: "p1", client: "c1", brand: "b1", status: "done", due: "2026-09-30" });
  });

  test("an unknown client is refused unless creating clients is allowed", () => {
    const map = { title: "0", client: "1" };
    const refused = checkRows("tasks", [["X", "Contoso"]], map, { mkClients: false, mkMembers: false }, data);
    expect(refused[0]!.ok).toBe(false);
    const allowed = checkRows("tasks", [["X", "Contoso"]], map, { mkClients: true, mkMembers: false }, data);
    expect(allowed[0]!.ok).toBe(true);
    expect((allowed[0]!.rec as TaskRec).newClient).toBe("Contoso");
  });

  test("a ledger row with a negative amount and no type is an expense", () => {
    const [row] = checkRows("ledger", [["2026-09-01", "Hosting", "-4500"]], { date: "0", desc: "1", amount: "2" }, { mkClients: false, mkMembers: false }, data);
    expect(row!.ok).toBe(true);
    expect(row!.rec as LedgerRec).toMatchObject({ type: "out", amount: 4500 });
  });

  test("foreign income keeps both amounts", () => {
    const [row] = checkRows(
      "ledger",
      [["2026-09-01", "Retainer", "83000", "Income", "USD", "1000"]],
      { date: "0", desc: "1", amount: "2", type: "3", cur: "4", orig: "5" },
      { mkClients: false, mkMembers: false },
      data,
    );
    expect(row!.rec as LedgerRec).toMatchObject({ type: "in", amount: 83000, cur: "USD", orig: 1000 });
  });

  test("every problem in a row is named, not just the first", () => {
    const [row] = checkRows("ledger", [["", "", "abc", "maybe"]], { date: "0", desc: "1", amount: "2", type: "3" }, { mkClients: false, mkMembers: false }, data);
    expect(row!.ok).toBe(false);
    expect(row!.msg).toContain("No date");
    expect(row!.msg).toContain("No description");
    expect(row!.msg).toContain("Amount is not a number");
  });

  test("a client already in the workspace, or twice in the file, is not imported again", () => {
    const rows = checkRows("clients", [["Northwind"], ["Contoso"], ["contoso"]], { name: "0" }, { mkClients: true, mkMembers: false }, data);
    expect(rows.map((r) => r.ok)).toEqual([false, true, false]);
  });

  test("leave for someone not on the team is refused", () => {
    const rows = checkRows(
      "leave",
      [
        ["Vikram", "Sick", "2026-10-01", "2026-10-02"],
        ["Ghost", "Sick", "2026-10-01", "2026-10-02"],
      ],
      { who: "0", type: "1", from: "2", to: "3" },
      { mkClients: false, mkMembers: false },
      data,
    );
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
  });
});
