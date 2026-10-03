/**
 * The access rules, as plain functions. The server enforces with these and the
 * screens decide what to offer with them, so they are tested once, here.
 */
import { describe, expect, test } from "vitest";
import {
  FEATURE_IDS,
  PRESETS,
  canEditTask,
  canLedger,
  canOverhead,
  clientLevel,
  featureLevel,
  grantKey,
  isTeamAdmin,
  reaches,
  type Grant,
  type Person,
} from "../src/lib/access";

const owner: Person = { id: "o", isOwner: true, features: {} };
const member: Person = { id: "m", isOwner: false, features: PRESETS.Member! };
const finance: Person = { id: "f", isOwner: false, features: PRESETS.Finance! };
const manager: Person = { id: "g", isOwner: false, features: PRESETS.Manager! };

const grants = new Map<string, Grant>([
  [grantKey("m", "c1"), "edit"],
  [grantKey("m", "c2"), "view"],
  [grantKey("f", "c1"), "finance"],
  [grantKey("g", "c1"), "edit"],
]);

describe("sections", () => {
  test("an owner holds every section at Edit, whatever is stored", () => {
    for (const f of FEATURE_IDS) expect(featureLevel({ ...owner, features: { [f]: "none" } }, f)).toBe("edit");
  });

  test("a missing section means no access, never a default grant", () => {
    expect(featureLevel({ id: "x", isOwner: false, features: {} }, "payroll")).toBe("none");
  });

  test("every preset names every section", () => {
    for (const [name, levels] of Object.entries(PRESETS)) {
      expect(Object.keys(levels).sort(), name).toEqual([...FEATURE_IDS].sort());
    }
  });
});

describe("clients", () => {
  test("levels rank view < edit < finance, and an owner outranks them all", () => {
    expect(reaches(member, "c1", "edit", grants)).toBe(true);
    expect(reaches(member, "c1", "finance", grants)).toBe(false);
    expect(reaches(member, "c2", "edit", grants)).toBe(false);
    expect(reaches(member, "c2", "view", grants)).toBe(true);
    expect(reaches(owner, "anything", "finance", grants)).toBe(true);
    expect(clientLevel(owner, "c9", grants)).toBe("owner");
  });

  test("no row means no access", () => {
    expect(clientLevel(member, "c3", grants)).toBe("none");
    expect(reaches(member, "c3", "view", grants)).toBe(false);
  });
});

describe("money", () => {
  test("a client's entries need Finance on that client", () => {
    expect(canLedger(finance, { clientId: "c1" }, grants)).toBe(true);
    expect(canLedger(member, { clientId: "c1" }, grants)).toBe(false);
  });

  test("overhead is for owners and whoever edits Income and expenses", () => {
    expect(canOverhead(owner)).toBe(true);
    expect(canOverhead(finance)).toBe(true);
    expect(canOverhead(manager)).toBe(false);
    expect(canLedger(manager, { clientId: null, category: "Rent" }, grants)).toBe(false);
  });

  test("a salary line needs Payroll even for someone who sees other overhead", () => {
    const noPayroll: Person = { id: "n", isOwner: false, features: { ...PRESETS.Finance!, payroll: "none" } };
    expect(canLedger(noPayroll, { clientId: null, category: "Rent" }, grants)).toBe(true);
    expect(canLedger(noPayroll, { clientId: null, category: "Salaries" }, grants)).toBe(false);
    expect(canLedger(finance, { clientId: null, category: "Salaries" }, grants)).toBe(true);
  });
});

describe("tasks and the team", () => {
  test("a client's task needs Edit on the client and on Tasks", () => {
    expect(canEditTask(member, { clientId: "c1" }, grants)).toBe(true);
    expect(canEditTask(member, { clientId: "c2" }, grants)).toBe(false);
    const viewTasks: Person = { id: "m", isOwner: false, features: { tasks: "view" } };
    expect(canEditTask(viewTasks, { clientId: "c1" }, grants)).toBe(false);
  });

  test("a brand's own task needs Edit on Tasks", () => {
    expect(canEditTask(member, { clientId: null }, grants)).toBe(true);
    expect(canEditTask({ id: "r", isOwner: false, features: PRESETS["Read only"]! }, { clientId: null }, grants)).toBe(false);
  });

  test("running the team is for owners and Team editors", () => {
    expect(isTeamAdmin(owner)).toBe(true);
    expect(isTeamAdmin(manager)).toBe(true);
    expect(isTeamAdmin(member)).toBe(false);
    expect(isTeamAdmin(finance)).toBe(false);
  });
});
