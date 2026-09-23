/** Every fixed list in the product lives here. Statuses are plain strings so
 *  SQLite stays happy and the values read the same in the sheet-like exports. */

export type Tone = "grey" | "blue" | "green" | "orange" | "red";

// ------------------------------------------------------------------ tasks --

export const TASK_STATUSES = ["Not Started", "In Review", "Completed", "Blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  "Not Started": "grey",
  "In Review": "orange",
  Completed: "green",
  Blocked: "red",
};

export const FREQUENCIES = ["Daily", "Weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// ------------------------------------------------------------------ roles --

export const ROLES = ["MANAGER", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
};

/** Managers run the company: money, everyone's tasks, settings. */
export function isManager(role: string): boolean {
  return role === "MANAGER";
}

// ---------------------------------------------------------------- finance --

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_STATUSES = ["Received", "Pending", "Paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  Received: "green",
  Paid: "green",
  Pending: "orange",
};

export const SALARY_STATUSES = ["Pending", "Partially Paid", "Paid"] as const;
export type SalaryStatus = (typeof SALARY_STATUSES)[number];

export const SALARY_STATUS_TONE: Record<SalaryStatus, Tone> = {
  Pending: "orange",
  "Partially Paid": "blue",
  Paid: "green",
};

export const CLIENT_STATUSES = ["Active", "Inactive"] as const;

export const CATEGORY_KINDS = ["EXPENSE", "INCOME"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Seeded on first run; fully editable in Settings. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Salary",
  "Food",
  "Travel",
  "Shopping",
  "Rent",
  "Utilities",
  "Entertainment",
  "Software",
  "Marketing",
  "Operations",
  "Office",
  "Taxes",
  "Other",
];

export const DEFAULT_INCOME_SOURCES = ["ARC3"];

/** The salary category is special: salary payments post into it automatically. */
export const SALARY_CATEGORY = "Salary";

export const CATEGORY_COLORS = ["slate", "blue", "green", "orange", "red", "violet", "teal", "amber"] as const;

export const COLOR_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  red: "bg-rose-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
};
