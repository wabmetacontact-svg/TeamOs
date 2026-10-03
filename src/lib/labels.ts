import type { Priority, TaskStatus } from "./types";

/** Task statuses in board order, with the words the audit trail uses. */
export const STATUS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];
export const statusLabel = (s: string) => STATUS.find((x) => x.id === s)?.label ?? s;

/** A task's displayed state: its status, or "late" when it is open and overdue. */
export type DisplayStatus = TaskStatus | "late";

export const PRI: Record<Priority, [label: string, bg: string, fg: string]> = {
  high: ["High", "#FEE2E2", "#B91C1C"],
  medium: ["Medium", "#FEF3C7", "#B45309"],
  low: ["Low", "#F1F5F9", "#475569"],
};

/** Status chip colours: [background, text]. */
export const SCHIP: Record<DisplayStatus, [string, string]> = {
  todo: ["#F1F5F9", "#475569"],
  doing: ["#DBEAFE", "#1D4ED8"],
  review: ["#FEF3C7", "#B45309"],
  blocked: ["#E2E8F0", "#0F172A"],
  done: ["#DCFCE7", "#15803D"],
  late: ["#FEE2E2", "#B91C1C"],
};

/** Calendar and history dots. */
export const DOT: Record<DisplayStatus, { bg: string; edge: string; label: string }> = {
  todo: { bg: "#fff", edge: "#94A3B8", label: "Not started" },
  doing: { bg: "#2563EB", edge: "#2563EB", label: "In progress" },
  review: { bg: "#F59E0B", edge: "#F59E0B", label: "Review" },
  blocked: { bg: "#0F172A", edge: "#0F172A", label: "Blocked" },
  done: { bg: "#16A34A", edge: "#16A34A", label: "Completed" },
  late: { bg: "#DC2626", edge: "#DC2626", label: "Late" },
};

export const LEAVE_TYPES = ["Annual", "Sick", "Personal", "Parental", "Unpaid"] as const;
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Intern", "Founder"] as const;
export const HR_STATUSES = ["Active", "Probation", "On leave", "Notice period", "Exited"] as const;

/** Colours a new task department cycles through. */
export const DEPT_PALETTE = ["#2563EB", "#5B5BD6", "#D97706", "#16A34A", "#DC2626", "#0EA5E9", "#DB2777", "#64748B"];

/** What a brand-new workspace starts with. Generic, so nobody has to delete them. */
export const DEFAULT_INCOME_CATEGORIES = ["Retainer", "Project fee", "Reimbursement"];
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Software",
  "Cloud / hosting",
  "Contractors",
  "Media",
  "Infrastructure",
  "Travel",
  "Events",
  "Salaries",
  "Rent",
  "Partner draw",
];
export const DEFAULT_HR_DEPARTMENTS = ["Leadership", "Operations", "Design", "Engineering", "Finance", "Content"];
export const DEFAULT_TASK_DEPARTMENTS = [
  { name: "Tech", color: "#2563EB" },
  { name: "Marketing", color: "#5B5BD6" },
  { name: "Ops & BD", color: "#D97706" },
];
