/**
 * Walks the running application the way a signed-in person would.
 *
 * It builds a small workspace, signs a real session cookie, asks the dev
 * server for every screen, and checks each one renders rather than erroring.
 * Then it deletes the workspace again, so it leaves nothing behind.
 *
 *   npm run dev          (in another terminal)
 *   npx tsx scripts/smoke.ts
 */
import { config } from "dotenv";
config();

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PRESETS } from "../src/lib/access";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_HR_DEPARTMENTS, DEFAULT_TASK_DEPARTMENTS } from "../src/lib/labels";
import { SESSION_COOKIE, signSession } from "../src/lib/session";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const id = () => randomUUID().replace(/-/g, "");
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = new Date().toISOString().slice(0, 10);
const ym = today.slice(0, 7);

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const slug = `smoke-${Date.now().toString(36)}`;
  const tenantId = id();
  console.log(`workspace ${slug}\n`);

  // ── a workspace with something on every screen
  const seeded = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: "Smoke workspace",
        slug,
        incomeCategories: DEFAULT_INCOME_CATEGORIES,
        expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
        hrDepartments: DEFAULT_HR_DEPARTMENTS,
      },
    });
    const depts = await Promise.all(
      DEFAULT_TASK_DEPARTMENTS.map((d, i) => tx.taskDepartment.create({ data: { tenantId, name: d.name, color: d.color, position: i } })),
    );
    const owner = await tx.member.create({
      data: { tenantId, name: "Priya Owner", email: `owner@${slug}.test`, passwordHash: "x", isOwner: true, title: "Founder", employmentType: "Founder", startDate: day("2026-01-05") },
    });
    const worker = await tx.member.create({
      data: {
        tenantId,
        name: "Rahul Writer",
        email: `rahul@${slug}.test`,
        passwordHash: "x",
        title: "Content writer",
        features: PRESETS.Member!,
        department: "Content",
        startDate: day("2026-03-01"),
        salary: 4_000_000n,
        salaryChanges: { create: { tenantId, effectiveFrom: day("2026-03-01"), amount: 4_000_000n } },
      },
    });
    const brand = await tx.brand.create({ data: { tenantId, name: "Northwind Agency", kind: "agency" } });
    const product = await tx.brand.create({ data: { tenantId, name: "Inhouse App", kind: "startup", areas: ["Social Media", "Tech"] } });
    const client = await tx.client.create({
      data: {
        tenantId,
        brandId: brand.id,
        name: "Acme Foods",
        company: "Acme Foods Pvt Ltd",
        retainer: 15_000_000n,
        services: "LinkedIn and X management",
        contact: "Neha Gupta",
        // This month, because the Clients screen lists the month's joiners by
        // default; a client from February would be in the data but not on screen.
        sinceDate: day(`${ym}-01`),
        payDay: 5,
        rates: { create: { tenantId, fromDate: day(`${ym}-01`), amount: 15_000_000n, currency: "INR" } },
      },
    });
    await tx.clientGrant.create({ data: { tenantId, memberId: worker.id, clientId: client.id, level: "edit" } });

    await tx.task.create({
      data: {
        tenantId,
        title: "October content calendar",
        brandId: brand.id,
        clientId: client.id,
        assigneeId: worker.id,
        assignedById: owner.id,
        departmentId: depts[1]!.id,
        status: "doing",
        due: day(`${ym}-15`),
        hours: 4,
        estimate: 6,
        createdOn: day(`${ym}-01`),
        changes: { create: { tenantId, status: "todo", byId: owner.id } },
        notes: { create: { tenantId, byId: worker.id, text: "Draft here https://docs.example.com/x", link: "https://docs.example.com/x" } },
      },
    });
    // An overdue one, and a finished one, so the calendar and KPIs have range.
    await tx.task.create({
      data: { tenantId, title: "Fix tracking pixel", brandId: product.id, area: "Tech", assigneeId: owner.id, assignedById: owner.id, departmentId: depts[0]!.id, due: day(`${ym}-02`), createdOn: day(`${ym}-01`) },
    });
    await tx.task.create({
      data: { tenantId, title: "September report", brandId: brand.id, clientId: client.id, assigneeId: worker.id, assignedById: owner.id, departmentId: depts[1]!.id, status: "done", verified: true, due: day(`${ym}-05`), createdOn: day(`${ym}-01`) },
    });
    await tx.taskSeries.create({
      data: { tenantId, title: "Daily standup note", brandId: brand.id, assigneeId: worker.id, createdById: owner.id, departmentId: depts[2]!.id, freq: "weekdays", startDate: day(`${ym}-01`) },
    });
    await tx.sheetColumn.create({ data: { tenantId, name: "Channel", position: 0 } });

    await tx.ledgerEntry.createMany({
      data: [
        { tenantId, type: "in", date: day(`${ym}-03`), description: "Acme retainer", clientId: client.id, category: "Retainer", amount: 15_000_000n, status: "paid", createdById: owner.id },
        { tenantId, type: "in", date: day(`${ym}-08`), description: "Overseas retainer", clientId: client.id, category: "Retainer", amount: 8_300_000n, status: "paid", currency: "USD", origAmount: 100_000n, createdById: owner.id },
        { tenantId, type: "out", date: day(`${ym}-04`), description: "Cloud hosting", clientId: client.id, category: "Cloud / hosting", amount: 1_200_000n, status: "paid", createdById: owner.id },
        { tenantId, type: "out", date: day(`${ym}-10`), description: "Office rent", category: "Rent", amount: 3_500_000n, status: "pending", createdById: owner.id },
        { tenantId, type: "out", date: day(`${ym}-12`), description: "Partner draw, Priya Owner", category: "Partner draw", amount: 2_000_000n, status: "paid", partnerId: owner.id, createdById: owner.id },
      ],
    });
    await tx.leave.create({ data: { tenantId, memberId: worker.id, type: "Sick", fromDate: day(`${ym}-20`), toDate: day(`${ym}-21`), note: "Fever" } });
    await tx.holiday.create({ data: { tenantId, date: day(`${ym}-25`), name: "Public holiday" } });
    await tx.auditEntry.create({ data: { tenantId, actorId: owner.id, actorName: owner.name, kind: "client", text: "added client “Acme Foods”", target: "Acme Foods", clientId: client.id, toValue: "Northwind Agency" } });

    const session = await tx.session.create({ data: { tenantId, memberId: owner.id, expiresAt: new Date(Date.now() + 864e5) } });
    const workerSession = await tx.session.create({ data: { tenantId, memberId: worker.id, expiresAt: new Date(Date.now() + 864e5) } });
    return { owner, worker, client, session, workerSession };
  },
  // Around forty inserts in one transaction, over the wire to a hosted
  // Postgres. Prisma's 5s default is the latency of the network, not of the
  // work: this failed at 5,117ms against Neon in Singapore, so the script was
  // unrunnable from a laptop for no better reason than distance.
  { timeout: 60_000, maxWait: 20_000 });

  const cookie = async (sid: string, uid: string) =>
    `${SESSION_COOKIE}=${await signSession({ sid, uid, tid: tenantId }, 86400)}`;
  const ownerCookie = await cookie(seeded.session.id, seeded.owner.id);
  const workerCookie = await cookie(seeded.workerSession.id, seeded.worker.id);

  async function page(path: string, jar: string, label: string, expect: string[] = []) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: jar }, redirect: "manual" });
    // React separates static text from interpolated values with comment
    // markers; strip them so a sentence can be matched as a person reads it.
    const body = res.status === 200 ? (await res.text()).replaceAll("<!-- -->", "") : "";
    const missing = expect.filter((t) => !body.includes(t));
    const crashed = body.includes("Application error") || body.includes("Internal Server Error");
    check(res.status === 200 && !crashed && !missing.length, label, res.status !== 200 ? `HTTP ${res.status}` : crashed ? "crashed" : missing.length ? `missing: ${missing.join(", ")}` : "");
  }

  console.log("public pages");
  for (const [p, label] of [
    ["/login", "login"],
    ["/signup", "signup"],
    ["/join/not-a-real-token", "join with a bad token"],
  ] as const) {
    const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
    check(res.status === 200, label, `HTTP ${res.status}`);
  }
  const guard = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
  check(guard.status === 307 && (guard.headers.get("location") ?? "").endsWith("/login"), "signed out is sent to login");

  console.log("\nowner");
  await page("/dashboard", ownerCookie, "dashboard", ["Spend by brand", "Acme Foods", "Recent changes"]);
  // ">Acme Foods<" is the rendered row, not the name inside the page's data -
  // every client is sent to the browser, so a bare name would match even when
  // the list shows nothing.
  await page("/clients", ownerCookie, "clients", [">Acme Foods<", "Acme Foods Pvt Ltd", "joined in"]);
  await page(`/clients/${seeded.client.id}`, ownerCookie, "client page", ["Acme Foods", "Received since onboarding", "Who worked on them"]);
  const monthLabel = new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  await page("/tasks", ownerCookie, "tasks", ["October content calendar", "Fix tracking pixel", "Recurring", monthLabel, "All time", "Calendar"]);
  await page("/team", ownerCookie, "team", ["Rahul Writer", "Headcount", "Leave requests", "Sales"]);
  await page("/ads", ownerCookie, "ads", ["New clients", "Spent on ads"]);
  await page("/targets", ownerCookie, "targets", ["Whole team", "Amount received", "Needed per day"]);
  await page("/expenses", ownerCookie, "income and expenses", ["Acme retainer", "Office rent", "Pending", "The Net above, opened up"]);
  await page("/access", ownerCookie, "access", ["Rahul Writer", "Apply preset", "Dashboard figures"]);
  await page("/audit", ownerCookie, "audit trail", ["added client"]);
  await page("/import", ownerCookie, "import", ["What are you importing?", "Income and expenses"]);

  console.log("\nmember (no payroll, one client, no access screen)");
  await page("/dashboard", workerCookie, "dashboard", ["Acme Foods"]);
  await page("/tasks", workerCookie, "tasks", ["October content calendar"]);
  await page("/team", workerCookie, "team is hidden", ["You don&#x27;t have access to Team"]);
  await page("/expenses", workerCookie, "expenses is hidden", ["You don&#x27;t have access to Expenses"]);

  const res = await fetch(`${BASE}/dashboard`, { headers: { cookie: workerCookie } });
  const body = await res.text();
  check(!body.includes("Office rent"), "overhead money is not sent to a member");
  check(!body.includes("40,000"), "salaries are not sent to a member");

  // ── clean up
  await db.tenant.delete({ where: { id: tenantId } });
  console.log(`\nworkspace deleted · ${failures ? `${failures} FAILED` : "all checks passed"}`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
