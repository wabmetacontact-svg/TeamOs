import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const rupees = (amount: number) => amount * 100;

async function main() {
  // Idempotent: wipe and rebuild the demo workspace.
  await db.salary.deleteMany();
  await db.transaction.deleteMany();
  await db.task.deleteMany();
  await db.client.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);
  const people = [
    { email: "jitesh@teamos.dev", name: "Jitesh", role: "MANAGER", designation: "Founder" },
    { email: "jasleen@teamos.dev", name: "Jasleen", role: "MANAGER", designation: "Operations Lead" },
    { email: "rahul@teamos.dev", name: "Rahul", role: "MEMBER", designation: "Strategy" },
    { email: "priya@teamos.dev", name: "Priya", role: "MEMBER", designation: "Marketing" },
    { email: "meyhar@teamos.dev", name: "Meyhar", role: "MEMBER", designation: "Developer" },
  ];

  const users: Record<string, string> = {};
  for (const p of people) {
    const user = await db.user.create({ data: { ...p, passwordHash } });
    users[p.name] = user.id;
  }
  const { Jitesh, Jasleen, Rahul, Priya, Meyhar } = users as Record<string, string>;

  // ---------------------------------------------------------------- tasks --
  const tasks = [
    { name: "Complete the $0.80 strategy", assigneeId: Rahul!, status: "Not Started", dueDate: day(0), recurring: true, frequency: "Daily", notes: "Daily strategy run." },
    { name: "Post client on LinkedIn and X", assigneeId: Priya!, status: "In Review", dueDate: day(-1), recurring: true, frequency: "Weekly", weekday: day(-1).getDay(), notes: "Weekly client post." },
    { name: "Prepare investor update", assigneeId: Jasleen!, status: "Completed", dueDate: day(-5), completedAt: day(-2), daysLate: 3, verifiedById: Jitesh!, docUrl: "https://docs.google.com/document/d/example", notes: "Shared with the board." },
    { name: "Fix payout reconciliation bug", assigneeId: Meyhar!, status: "Blocked", dueDate: day(-3), notes: "Waiting on bank API access." },
    { name: "Publish September case study", assigneeId: Priya!, status: "Not Started", dueDate: day(4) },
    { name: "Review vendor contracts", assigneeId: Jasleen!, status: "Completed", dueDate: day(-8), completedAt: day(-8), daysLate: 0, verifiedById: Jitesh! },
    { name: "Ship analytics dashboard", assigneeId: Meyhar!, status: "In Review", dueDate: day(1), docUrl: "https://github.com/example/pull/42" },
    { name: "Daily standup notes", assigneeId: Rahul!, status: "Completed", dueDate: day(-1), completedAt: day(-1), daysLate: 0, recurring: true, frequency: "Daily", nextCreated: true },
    { name: "Daily standup notes", assigneeId: Rahul!, status: "Not Started", dueDate: day(0), recurring: true, frequency: "Daily" },
  ];

  for (const t of tasks) {
    await db.task.create({
      data: {
        ...t,
        recurringStart: t.recurring ? t.dueDate : null,
        createdById: Jitesh!,
      },
    });
  }

  // ----------------------------------------------------------- categories --
  const expenseNames = ["Salary", "Food", "Travel", "Shopping", "Rent", "Utilities", "Software", "Marketing", "Operations", "Office", "Taxes", "Other"];
  const colors = ["violet", "orange", "blue", "teal", "amber", "green", "red", "slate"];
  const categories: Record<string, string> = {};
  for (const [i, name] of expenseNames.entries()) {
    const c = await db.category.create({ data: { name, kind: "EXPENSE", color: colors[i % colors.length]! } });
    categories[name] = c.id;
  }
  const arc3 = await db.category.create({ data: { name: "ARC3", kind: "INCOME", color: "green" } });

  // -------------------------------------------------------------- clients --
  const client = await db.client.create({
    data: {
      name: "ARC3",
      company: "ARC3",
      contactPerson: "Daniel",
      email: "accounts@arc3.example",
      project: "Consulting",
      contractValue: rupees(500000),
      paymentTerms: "Monthly",
      status: "Active",
    },
  });
  const secondClient = await db.client.create({
    data: { name: "Nova Labs", company: "Nova Labs Pvt Ltd", project: "Retainer", contractValue: rupees(240000), paymentTerms: "Monthly", status: "Active" },
  });

  // ---------------------------------------------------------- transactions --
  let seq = 0;
  const ref = (d: Date) => {
    seq++;
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `TX-${stamp}-${String(seq).padStart(3, "0")}`;
  };

  const entries = [
    { type: "INCOME", date: day(-20), name: "ARC3", categoryId: arc3.id, clientId: client.id, usdt: 1000, rate: 100, amount: rupees(100000), status: "Received", notes: "September payment" },
    { type: "INCOME", date: day(-3), name: "ARC3", categoryId: arc3.id, clientId: client.id, usdt: 1500, rate: 91.5, amount: rupees(137250), status: "Received", notes: "Milestone 2" },
    { type: "INCOME", date: day(2), name: "Nova Labs", categoryId: arc3.id, clientId: secondClient.id, amount: rupees(60000), status: "Pending", notes: "Invoice sent" },
    { type: "EXPENSE", date: day(-18), name: "Landlord", categoryId: categories.Rent!, amount: rupees(40000), status: "Paid", notes: "Office rent" },
    { type: "EXPENSE", date: day(-14), name: "AWS", categoryId: categories.Software!, amount: rupees(18500), status: "Paid" },
    { type: "EXPENSE", date: day(-9), name: "Swiggy", categoryId: categories.Food!, amount: rupees(800), status: "Paid", notes: "Team lunch" },
    { type: "EXPENSE", date: day(-7), name: "Google Ads", categoryId: categories.Marketing!, amount: rupees(25000), status: "Paid" },
    { type: "EXPENSE", date: day(-6), name: "Uber", categoryId: categories.Travel!, amount: rupees(1450), status: "Paid", notes: "Client meeting" },
    { type: "EXPENSE", date: day(-2), name: "Airtel", categoryId: categories.Utilities!, amount: rupees(2600), status: "Paid" },
  ];

  for (const e of entries) {
    await db.transaction.create({ data: { ...e, ref: ref(e.date), createdById: Jitesh! } });
  }

  // ------------------------------------------------------------- salaries --
  const thisMonth = monthOf(new Date());
  const salaryPeople = [
    { employeeName: "Jasleen", amount: rupees(30000), status: "Paid" },
    { employeeName: "Rahul", amount: rupees(35000), status: "Paid" },
    { employeeName: "Priya", amount: rupees(25000), status: "Pending" },
    { employeeName: "Meyhar", amount: rupees(30000), status: "Partially Paid", amountPaid: rupees(15000) },
  ];

  for (const s of salaryPeople) {
    const paid = s.status === "Paid" ? s.amount : (s.amountPaid ?? 0);
    const paymentDate = s.status === "Pending" ? null : day(-4);
    const salary = await db.salary.create({
      data: {
        employeeName: s.employeeName,
        amount: s.amount,
        month: thisMonth,
        status: s.status,
        amountPaid: paid,
        paymentDate,
        notes: `${thisMonth} salary`,
      },
    });

    // Salaries always post into the ledger, exactly like the app does.
    if (paid > 0 && paymentDate) {
      const tx = await db.transaction.create({
        data: {
          ref: ref(paymentDate),
          type: "EXPENSE",
          date: paymentDate,
          categoryId: categories.Salary!,
          name: s.employeeName,
          amount: paid,
          status: "Paid",
          notes: `${s.employeeName} — salary for ${thisMonth}`,
          createdById: Jitesh!,
        },
      });
      await db.salary.update({ where: { id: salary.id }, data: { transactionId: tx.id } });
    }
  }

  console.log("Seeded 5 users, 9 tasks, 2 clients, 13 transactions, 4 salaries.");
  console.log("Manager login: jitesh@teamos.dev / password123");
  console.log("Member login:  rahul@teamos.dev / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
