/**
 * Reading spreadsheets. The same checks run in the browser for the preview and
 * on the server before anything is written, so they are tested once.
 */
import { describe, expect, test } from "vitest";
import { adKey, autoMap, checkRows, ledgerKey, parseCSV, toISO, toNum, toYM, type AdRec, type ClientRec, type ImportData, type LedgerRec, type TaskRec } from "../src/lib/importer";

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

describe("earlier data", () => {
  const none = { mkClients: false, mkMembers: false };

  test("months in the shapes people type them", () => {
    expect(toYM("2026-09")).toBe("2026-09");
    expect(toYM("9/2026")).toBe("2026-09");
    expect(toYM("Sep 2026")).toBe("2026-09");
    expect(toYM("September-26")).toBe("2026-09");
    expect(toYM("15/09/2026")).toBe("2026-09");
    expect(toYM("")).toBe("");
    expect(toYM("Smarch 2026")).toBeNull();
    expect(toYM("2026-13")).toBeNull();
  });

  test("a client brings its sales person, onboarder and account", () => {
    const [row] = checkRows(
      "clients",
      [["Contoso", "asha", "Vikram Shah", "contoso@mail.in", "+91 98765 43210", "Pays on the 5th"]],
      { name: "0", seller: "1", onboarder: "2", login: "3", phone: "4", details: "5" },
      none,
      data,
    );
    expect(row!.ok).toBe(true);
    expect(row!.rec as ClientRec).toMatchObject({ seller: "p1", onboarder: "p2", loginId: "contoso@mail.in", phone: "+91 98765 43210", details: "Pays on the 5th" });
  });

  test("a sales person not on the team is refused, or added when allowed", () => {
    const map = { name: "0", seller: "1" };
    expect(checkRows("clients", [["Contoso", "Rohit"]], map, none, data)[0]!.ok).toBe(false);
    const [row] = checkRows("clients", [["Contoso", "Rohit"]], map, { mkClients: false, mkMembers: true }, data);
    expect(row!.ok).toBe(true);
    expect((row!.rec as ClientRec).newSeller).toBe("Rohit");
  });

  test("columns for the new client fields match by name", () => {
    expect(autoMap("clients", ["Client Name", "Sales Person", "Onboarded By", "Login ID", "Mobile"])).toMatchObject({
      name: "0",
      seller: "1",
      onboarder: "2",
      login: "3",
      phone: "4",
    });
  });

  test("a ledger row already recorded is not imported again", () => {
    const ledgerKeys = new Set([ledgerKey({ type: "in", date: "2026-09-01", paise: 8_300_000, clientId: "c1", desc: "Retainer, Sept" })]);
    const rows = checkRows(
      "ledger",
      [
        ["2026-09-01", "Retainer, Sept", "83000", "Income", "Northwind"],
        ["2026-09-02", "Retainer, Sept", "83000", "Income", "Northwind"],
      ],
      { date: "0", desc: "1", amount: "2", type: "3", client: "4" },
      none,
      { ...data, ledgerKeys },
    );
    expect(rows.map((r) => r.ok)).toEqual([false, true]);
    expect(rows[0]!.msg).toContain("Already in the ledger");
  });

  test("a ledger row can say whose it is", () => {
    const [row] = checkRows("ledger", [["2026-09-28", "Salary", "25000", "Expense", "Asha Rao"]], { date: "0", desc: "1", amount: "2", type: "3", member: "4" }, none, data);
    expect((row!.rec as LedgerRec).member).toBe("p1");
    expect(checkRows("ledger", [["2026-09-28", "Salary", "25000", "Expense", "Ghost"]], { date: "0", desc: "1", amount: "2", type: "3", member: "4" }, none, data)[0]!.ok).toBe(false);
  });

  test("ad spend by person and month", () => {
    const map = { who: "0", month: "1", amount: "2", leads: "3", note: "4" };
    const adKeys = new Set([adKey({ memberId: "p1", month: "2026-08", paise: 1_000_000, leads: 40 })]);
    const rows = checkRows(
      "ads",
      [
        ["Asha", "Sep 2026", "₹12,900", "310", "Meta"],
        ["Asha", "Aug 2026", "10000", "40", ""],
        ["Ghost", "Sep 2026", "100", "1", ""],
        ["Vikram", "Sep 2026", "", "", ""],
        ["Vikram", "Sep 2026", "500", "2.5", ""],
      ],
      map,
      none,
      { ...data, adKeys },
    );
    expect(rows.map((r) => r.ok)).toEqual([true, false, false, false, false]);
    expect(rows[0]!.rec as AdRec).toMatchObject({ who: "p1", month: "2026-09", amount: 12900, leads: 310, note: "Meta" });
    expect(rows[1]!.msg).toContain("Already recorded");
  });
});
