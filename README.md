# TeamOS

Team tasks and company finance in one small web app. One central ledger, one task list, eight screens.

## Run it

```bash
npm install
npm run db:seed     # demo data (safe to re-run; it rebuilds the demo workspace)
npm run dev         # http://localhost:3000
```

The database is a single file, `prisma/dev.db`. No Docker, no server to install.

Demo logins (password `password123`):

| Email | Role | Sees |
|---|---|---|
| `jitesh@teamos.dev` | Manager | Everything, including money |
| `rahul@teamos.dev` | Member | Only their own tasks |

## Switching from demo data to your real data

The demo rows are only there so the screens aren't empty. When you're ready:

```bash
npm run db:fresh -- --name "Your Name" --email you@company.com --password "your password"
```

This deletes every demo row (it asks you to type `delete` first), keeps the default categories, and leaves one manager account — yours. Then, in the app:

1. **Settings → Team → Add member** for each person. They sign in with the email and password you set, and you can reset a password any time.
2. **Tasks → New task** for real work. Turn on *Recurring* for anything daily or weekly.
3. **Transactions → Income / Expense** for real money, **Clients → Add client**, **Salaries → Add salary**.

Nothing else is needed — there is no import step and no spreadsheet to keep in sync. Salaries and client payments post into the ledger by themselves.

## Exporting your data

Every screen with data has an **Export** button, and Reports has all three in one place:

| Where | File | Contains |
|---|---|---|
| Tasks | `teamos-tasks-all.csv` | Task, assignee, status, due, completed, days late, days overdue, timing, verified by, doc link, recurring, notes |
| Salaries | `teamos-salaries-2026-09.csv` | Employee, month, salary, paid, pending, payment date, status, ledger ref, notes |
| Transactions | `teamos-transactions-2026-09.csv` | Transaction ID, date, type, category/source, name, client, USDT, rate, amount, status, notes |

For money screens you pick **this month only** or **everything (all time)**. Amounts export as plain rupee numbers (`30000`, not `₹30,000`) so you can total the column in Excel or Sheets, and the file opens with the right characters without any import wizard.

Members can export their own tasks; the money exports are blocked for them on the server, not just hidden.

## Screens

| Screen | What it does |
|---|---|
| **Dashboard** | Income, expenses, net balance, receivables and salary status for the selected month, plus your open tasks |
| **Tasks** | Task list with search and filters, and a Team Performance tab |
| **Transactions** | The ledger. Add income or expenses here; click any row for the full detail |
| **Clients** | Contract value, received, outstanding, last payment. Record a payment in ₹ or USDT |
| **Salaries** | Monthly payroll. Marking a salary paid records the expense for you |
| **Calendar** | Money movement and task deadlines, day by day |
| **Reports** | Monthly trend, expense by category, income by source, top payees, salary and client reports |
| **Settings** | Your profile and password; managers also manage the team and categories |

## The rules this app is built on

1. **One ledger.** Every rupee lives in the `Transaction` table. Salaries and client payments write into it — nothing keeps its own copy of an amount.
2. **Never enter the same thing twice.** Mark a salary paid → the expense appears. Record a client payment → the income appears. Complete a recurring task → the next occurrence appears.
3. **The month is a filter, never a table.** No January/February copies of anything.
4. **Recurring tasks stay on schedule.** The next occurrence is based on the *due* date, not the day it was finished, and only one future occurrence ever exists.
5. **Late and overdue are different.** "3 days late" is for finished work; "3 days overdue" is for work still open. "0 days late" is never shown — that is "On time".
6. **Money is integers.** Amounts are stored in paise, so totals can't drift. USDT × rate is converted in exactly one place.
7. **Members never see money.** The finance screens are hidden from them *and* blocked on the server.

## Project layout

```
prisma/schema.prisma        the whole data model
src/lib/ledger.ts           salary → expense, client → income, totals
src/lib/task-logic.ts       recurrence, days late/overdue, performance
src/lib/money.ts            paise helpers, USDT conversion
src/app/(app)/<screen>/     each screen + its server actions
src/components/ui/          buttons, inputs, cards, dialog
src/components/app/         forms and lists shared across screens
```

## Deploying later

SQLite is fine on one machine. To put this online, point `DATABASE_URL` at a hosted Postgres, change the Prisma `provider` to `postgresql`, and re-run the migration — no application code changes, since no Prisma enums are used.
