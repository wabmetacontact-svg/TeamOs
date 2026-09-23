import { format } from "date-fns";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManager } from "@/lib/constants";
import { monthLabel, monthRange } from "@/lib/dates";
import { toRupees } from "@/lib/money";
import { computeDaysOverdue, recurrenceLabel, timingFor, weekdayName } from "@/lib/task-logic";
import { csvResponse } from "@/lib/csv";

const day = (d: Date | null | undefined) => (d ? format(d, "dd/MM/yyyy") : "");

/**
 * CSV export for tasks, salaries and transactions.
 * Money leaves as plain rupee numbers so a spreadsheet can sum the column.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "transactions";
  const monthParam = params.get("m");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;
  const range = month ? monthRange(month) : null;
  const suffix = month ? `-${month}` : "-all";
  const manager = isManager(user.role);

  // Money is manager-only, exactly like the screens it comes from.
  if ((type === "transactions" || type === "salaries") && !manager) {
    return new Response("Forbidden", { status: 403 });
  }

  if (type === "tasks") {
    const tasks = await db.task.findMany({
      where: {
        ...(manager ? {} : { assigneeId: user.id }),
        ...(range ? { dueDate: { gte: range.start, lte: range.end } } : {}),
      },
      include: { assignee: { select: { name: true } }, verifiedBy: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }],
    });

    const rows: (string | number)[][] = [
      [
        "Task",
        "Assignee",
        "Status",
        "Due Date",
        "Completed Date",
        "Days Late",
        "Days Overdue",
        "Timing",
        "Verified By",
        "Submit Doc",
        "Recurring",
        "Notes",
      ],
      ...tasks.map((t) => {
        const timing = timingFor(t);
        return [
          t.name,
          t.assignee.name,
          t.status,
          day(t.dueDate),
          day(t.completedAt),
          t.daysLate ?? "",
          computeDaysOverdue(t.dueDate, t.status) || "",
          timing?.label ?? "",
          t.verifiedBy?.name ?? "",
          t.docUrl ?? "",
          t.recurring ? recurrenceLabel({ recurring: true, frequency: t.frequency, weekday: t.weekday }) || weekdayName(t.weekday) : "",
          t.notes ?? "",
        ];
      }),
    ];
    return csvResponse(rows, `teamos-tasks${suffix}.csv`);
  }

  if (type === "salaries") {
    const salaries = await db.salary.findMany({
      where: month ? { month } : {},
      include: { transaction: { select: { ref: true } } },
      orderBy: [{ month: "desc" }, { employeeName: "asc" }],
    });

    const rows: (string | number)[][] = [
      ["Employee", "Salary Month", "Monthly Salary (INR)", "Amount Paid (INR)", "Pending (INR)", "Payment Date", "Status", "Ledger Ref", "Notes"],
      ...salaries.map((s) => [
        s.employeeName,
        monthLabel(s.month),
        toRupees(s.amount),
        toRupees(s.amountPaid),
        toRupees(s.amount - s.amountPaid),
        day(s.paymentDate),
        s.status,
        s.transaction?.ref ?? "",
        s.notes ?? "",
      ]),
    ];
    return csvResponse(rows, `teamos-salaries${suffix}.csv`);
  }

  const transactions = await db.transaction.findMany({
    where: range ? { date: { gte: range.start, lte: range.end } } : {},
    include: { category: { select: { name: true } }, client: { select: { name: true } }, salary: { select: { id: true } } },
    orderBy: [{ date: "asc" }, { ref: "asc" }],
  });

  const rows: (string | number)[][] = [
    ["Transaction ID", "Date", "Type", "Category / Source", "Name", "Client", "USDT", "Rate", "Amount (INR)", "Status", "From Salary", "Notes"],
    ...transactions.map((t) => [
      t.ref,
      day(t.date),
      t.type === "INCOME" ? "Income" : "Expense",
      t.category?.name ?? "",
      t.name,
      t.client?.name ?? "",
      t.usdt ?? "",
      t.rate ?? "",
      toRupees(t.amount),
      t.status,
      t.salary ? "Yes" : "",
      t.notes ?? "",
    ]),
  ];
  return csvResponse(rows, `teamos-transactions${suffix}.csv`);
}
