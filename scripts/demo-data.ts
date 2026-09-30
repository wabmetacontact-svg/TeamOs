/**
 * Demo data, for trying the application out.
 *
 * Everything this writes is tagged so it can be removed in one command:
 *
 *   npm run db:demo        adds it
 *   npm run db:clean-demo  removes it, and nothing else
 *
 * Clients get `subTag: "demo"`, ledger entries get a `demo` tag, people get a
 * marker in their notes. Nothing already in the workspace is touched, and
 * re-running is safe — it checks before it writes.
 *
 * The shapes are chosen to exercise the things that are easy to get wrong
 * rather than to look impressive: a foreign-currency entry, an entry booked to
 * a month other than its date's, a month with unapproved rows still in it, a
 * person in two pipelines at once, and a closed month you cannot write to.
 */
import { PrismaClient } from "@prisma/client";
import { bookMonthOf, convert, parseAmount, previousBookMonth } from "../src/lib/money";

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const DEMO_TAG = "demo";

async function main() {
  const tenant = await db.tenant.findFirst({ where: { slug: "hephaestus" } });
  if (!tenant) throw new Error("No Hephaestus tenant. Run `npm run db:seed` first.");

  const tenantId = tenant.id;

  const existing = await db.client.count({ where: { tenantId, subTag: DEMO_TAG, deletedAt: null } });
  if (existing > 0) {
    console.log(`\n  ${existing} demo clients already here. Run \`npm run db:clean-demo\` first to start over.\n`);
    return;
  }

  const [brands, categories, users, contexts] = await Promise.all([
    db.brand.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { tenantId } }),
    db.user.findMany({ where: { tenantId, status: "Active" }, orderBy: { createdAt: "asc" } }),
    db.context.findMany({ where: { tenantId }, include: { stages: { orderBy: { position: "asc" } } } }),
  ]);

  if (brands.length === 0 || users.length === 0) throw new Error("Seed the workspace first: npm run db:seed");

  const owner = users[0]!;
  const second = users[1] ?? owner;
  const spend = categories.filter((c) => c.direction === "OUT");
  const income = categories.filter((c) => c.direction === "IN");

  const thisMonth = bookMonthOf(new Date());
  const lastMonth = previousBookMonth(thisMonth);
  const monthBefore = previousBookMonth(lastMonth);

  console.log(`\n  Adding demo data to ${tenant.name}…`);

  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;

      // ── vendors, so the ledger has something to attribute spend to
      const vendorNames = ["Adobe", "Amazon Web Services", "WeWork", "Zoho", "Google Workspace", "Freelancer"];
      await tx.vendor.createMany({
        data: vendorNames.map((name) => ({ tenantId, name, notes: DEMO_TAG })),
        skipDuplicates: true,
      });
      const vendors = await tx.vendor.findMany({ where: { tenantId, name: { in: vendorNames } } });

      // ── clients across the brands that exist
      const clientSpecs = [
        { name: "Northwind Labs", status: "Active", currency: "INR" },
        { name: "Kestrel Media", status: "Active", currency: "INR" },
        { name: "Orbit Fintech", status: "Active", currency: "USD" },
        { name: "Pale Blue Studio", status: "Paused", currency: "INR" },
        { name: "Tanager Foods", status: "Onboarding", currency: "INR" },
        { name: "Halcyon Retail", status: "Active", currency: "INR" },
      ];

      const clients = [];
      for (const [i, spec] of clientSpecs.entries()) {
        clients.push(
          await tx.client.create({
            data: {
              tenantId,
              brandId: brands[i % brands.length]!.id,
              name: spec.name,
              subTag: DEMO_TAG,
              status: spec.status,
              billingCurrency: spec.currency,
              startDate: new Date(Date.UTC(2025, i, 1)),
              notes: "Demo client. Remove with `npm run db:clean-demo`.",
            },
          }),
        );
      }
      console.log(`    ${clients.length} clients`);

      // ── people, with relationships across pipelines
      const peopleSpecs = [
        { name: "Priya Sharma", email: "priya@northwind.demo", note: "Angel, ex-operator" },
        { name: "Raj Mehta", email: "raj@kestrel.demo", note: "Runs their marketing" },
        { name: "Ananya Iyer", email: "ananya@orbit.demo", note: "CFO" },
        { name: "Vikram Nair", email: "vikram@paleblue.demo", note: "Founder" },
        { name: "Meera Krishnan", email: "meera@tanager.demo", note: "Creator, 200k followers" },
        { name: "Arjun Desai", email: "arjun@halcyon.demo", note: "Introduced by Priya" },
        { name: "Sana Qureshi", email: "sana@fund.demo", note: "Partner at a seed fund" },
        { name: "Dev Patel", email: "dev@studio.demo", note: "Video, freelance" },
      ];

      const people = [];
      for (const spec of peopleSpecs) {
        people.push(
          await tx.person.create({
            data: { tenantId, name: spec.name, email: spec.email, notes: `${spec.note} · ${DEMO_TAG}` },
          }),
        );
      }
      console.log(`    ${people.length} people`);

      // Contacts at clients
      for (const [i, person] of people.slice(0, 5).entries()) {
        await tx.clientContact.create({
          data: { tenantId, clientId: clients[i]!.id, personId: person.id, title: "Main contact", isPrimary: true },
        });
      }

      // ── relationships. Priya and Sana each sit in two pipelines at once,
      //    which is the thing three spreadsheets could not express.
      if (contexts.length > 0) {
        const pick = (name: string) => contexts.find((c) => c.name === name) ?? contexts[0]!;
        const investor = pick("Investor");
        const kol = pick("KOL");
        const sales = pick("Sales");

        const relSpecs: { personIndex: number; context: typeof investor; stageIndex: number; owner: string; value?: string; clientIndex?: number }[] = [
          { personIndex: 0, context: investor, stageIndex: 2, owner: owner.id, value: "50,00,000" },
          { personIndex: 0, context: kol, stageIndex: 1, owner: second.id },
          { personIndex: 6, context: investor, stageIndex: 1, owner: owner.id, value: "1,00,00,000" },
          { personIndex: 6, context: sales, stageIndex: 0, owner: second.id },
          { personIndex: 4, context: kol, stageIndex: 2, owner: second.id, value: "1,50,000" },
          { personIndex: 7, context: kol, stageIndex: 0, owner: second.id },
          { personIndex: 2, context: sales, stageIndex: 3, owner: owner.id, value: "8,00,000", clientIndex: 2 },
          { personIndex: 5, context: sales, stageIndex: 1, owner: owner.id, value: "3,50,000", clientIndex: 5 },
        ];

        let created = 0;
        for (const spec of relSpecs) {
          const stage = spec.context.stages[Math.min(spec.stageIndex, spec.context.stages.length - 1)];
          if (!stage) continue;

          const relationship = await tx.relationship.create({
            data: {
              tenantId,
              personId: people[spec.personIndex]!.id,
              contextId: spec.context.id,
              stageId: stage.id,
              ownerId: spec.owner,
              clientId: spec.clientIndex != null ? clients[spec.clientIndex]!.id : null,
              value: spec.value ? parseAmount(spec.value, "INR") : null,
              notes: `Demo relationship · ${DEMO_TAG}`,
            },
          });

          await tx.relationshipStageChange.create({
            data: { tenantId, relationshipId: relationship.id, toStageId: stage.id, actorId: spec.owner },
          });

          await tx.activity.create({
            data: {
              tenantId,
              personId: people[spec.personIndex]!.id,
              relationshipId: relationship.id,
              type: ["Call", "Meeting", "Message"][created % 3]!,
              subject: ["First conversation", "Sent the deck", "Follow-up call"][created % 3]!,
              occurredAt: new Date(Date.now() - created * 3 * 86_400_000),
              actorId: spec.owner,
            },
          });

          created++;
        }
        console.log(`    ${created} relationships across ${new Set(relSpecs.map((r) => r.context.id)).size} pipelines`);
      }

      // ── the ledger. Three months, with the awkward cases in it.
      type Entry = {
        month: string;
        day: number;
        client: number;
        name: string;
        amount: string;
        direction: "IN" | "OUT";
        currency?: string;
        rate?: string;
        state?: string;
        vendor?: number;
        bookTo?: string;
      };

      const entries: Entry[] = [
        // Two months ago — will be closed at the end, so it is frozen.
        { month: monthBefore, day: 1, client: 0, name: "Office rent", amount: "45,000", direction: "OUT", vendor: 2 },
        { month: monthBefore, day: 3, client: 0, name: "AWS", amount: "18,400", direction: "OUT", vendor: 1 },
        { month: monthBefore, day: 5, client: 1, name: "Adobe CC", amount: "4,230", direction: "OUT", vendor: 0 },
        { month: monthBefore, day: 10, client: 0, name: "Retainer", amount: "2,50,000", direction: "IN" },
        { month: monthBefore, day: 12, client: 1, name: "Retainer", amount: "1,20,000", direction: "IN" },
        { month: monthBefore, day: 20, client: 5, name: "Project fee", amount: "85,000", direction: "IN" },

        // Last month — a full month, all approved.
        { month: lastMonth, day: 1, client: 0, name: "Office rent", amount: "45,000", direction: "OUT", vendor: 2 },
        { month: lastMonth, day: 3, client: 0, name: "AWS", amount: "21,900", direction: "OUT", vendor: 1 },
        { month: lastMonth, day: 4, client: 1, name: "Adobe CC", amount: "4,230", direction: "OUT", vendor: 0 },
        { month: lastMonth, day: 6, client: 2, name: "Stripe fees", amount: "129.40", direction: "OUT", currency: "USD", rate: "83.60" },
        { month: lastMonth, day: 8, client: 1, name: "Freelance editor", amount: "32,000", direction: "OUT", vendor: 5 },
        { month: lastMonth, day: 10, client: 0, name: "Retainer", amount: "2,50,000", direction: "IN" },
        { month: lastMonth, day: 12, client: 1, name: "Retainer", amount: "1,20,000", direction: "IN" },
        { month: lastMonth, day: 15, client: 2, name: "Retainer", amount: "4,200.00", direction: "IN", currency: "USD", rate: "83.60" },
        { month: lastMonth, day: 22, client: 5, name: "Campaign fee", amount: "1,75,000", direction: "IN" },
        { month: lastMonth, day: 28, client: 3, name: "Zoho", amount: "2,400", direction: "OUT", vendor: 3 },

        // This month — a mix, so the approvals queue has something in it.
        { month: thisMonth, day: 1, client: 0, name: "Office rent", amount: "45,000", direction: "OUT", vendor: 2 },
        { month: thisMonth, day: 2, client: 0, name: "AWS", amount: "23,150", direction: "OUT", vendor: 1, state: "Submitted" },
        { month: thisMonth, day: 3, client: 1, name: "Adobe CC", amount: "4,230", direction: "OUT", vendor: 0, state: "Submitted" },
        { month: thisMonth, day: 4, client: 4, name: "Photography", amount: "55,000", direction: "OUT", state: "Submitted" },
        { month: thisMonth, day: 5, client: 2, name: "Google Workspace", amount: "96.00", direction: "OUT", currency: "USD", rate: "84.10", state: "Draft", vendor: 4 },
        { month: thisMonth, day: 6, client: 5, name: "Print run", amount: "12,750", direction: "OUT", state: "Draft" },
        { month: thisMonth, day: 10, client: 0, name: "Retainer", amount: "2,50,000", direction: "IN" },
        { month: thisMonth, day: 11, client: 1, name: "Retainer", amount: "1,20,000", direction: "IN" },
        // Paid this month, but for last month's work — the book month differs
        // from the date on purpose, because that is the case people get wrong.
        { month: thisMonth, day: 2, client: 5, name: "Late invoice, prior month", amount: "48,000", direction: "IN", bookTo: lastMonth },
      ];

      const refCounter = new Map<string, number>();
      let count = 0;

      for (const entry of entries) {
        const date = new Date(`${entry.month}-${String(entry.day).padStart(2, "0")}T00:00:00Z`);
        const stamp = `${entry.month}-${String(entry.day).padStart(2, "0")}`.replace(/-/g, "");
        const n = (refCounter.get(stamp) ?? 0) + 1;
        refCounter.set(stamp, n);

        const currency = entry.currency ?? "INR";
        const rate = entry.rate ?? "1";
        const original = parseAmount(entry.amount, currency)!;
        const state = entry.state ?? "Approved";
        const approved = state === "Approved";

        const pool = entry.direction === "IN" ? income : spend;
        const category = pool.length ? pool[count % pool.length]! : null;

        await tx.transaction.create({
          data: {
            tenantId,
            ref: `TX-${stamp}-${String(n).padStart(3, "0")}`,
            direction: entry.direction,
            clientId: clients[entry.client]!.id,
            bookMonth: entry.bookTo ?? entry.month,
            date,
            categoryId: category?.id ?? null,
            vendorId: entry.vendor != null ? (vendors[entry.vendor]?.id ?? null) : null,
            name: entry.name,
            amountOriginal: original,
            currencyOriginal: currency,
            exchangeRate: rate,
            // Converted once, here, at this rate — exactly as the application
            // does it. Nothing recomputes it afterwards.
            amountBase: convert(original, rate, currency, tenant.baseCurrency),
            paymentMethod: entry.direction === "IN" ? "Bank" : count % 3 === 0 ? "Card" : "Bank",
            paymentStatus: count % 7 === 0 ? "Pending" : "Paid",
            description: `Demo entry · ${DEMO_TAG}`,
            tags: [DEMO_TAG],
            approvalState: state,
            submittedAt: state === "Draft" ? null : date,
            approvedById: approved ? owner.id : null,
            approvedAt: approved ? date : null,
            createdById: count % 3 === 0 ? second.id : owner.id,
          },
        });
        count++;
      }
      console.log(`    ${count} ledger entries across ${monthBefore}, ${lastMonth}, ${thisMonth}`);

      // ── a recurring rule or two
      await tx.recurringSpend.createMany({
        data: [
          {
            tenantId,
            clientId: clients[0]!.id,
            categoryId: spend[0]?.id ?? null,
            name: "Office rent",
            amount: parseAmount("45,000", "INR")!,
            dayOfMonth: 1,
            nextRunAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)),
          },
          {
            tenantId,
            clientId: clients[1]!.id,
            categoryId: spend[1]?.id ?? null,
            name: "Adobe CC",
            amount: parseAmount("4,230", "INR")!,
            dayOfMonth: 4,
            nextRunAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 4)),
          },
        ],
      });
      console.log(`    2 recurring rules`);

      // ── close the oldest month for the first two clients, so the frozen
      //    state is something you can actually try to write to.
      for (const client of clients.slice(0, 2)) {
        await tx.bookMonth.create({
          data: {
            tenantId,
            clientId: client.id,
            month: monthBefore,
            state: "Closed",
            closedAt: new Date(),
            closedById: owner.id,
          },
        });
      }
      console.log(`    ${monthBefore} closed for 2 clients — try editing an entry in it`);
    },
    { timeout: 180_000, maxWait: 30_000 },
  );

  console.log(`\n  Done. Remove it all with: npm run db:clean-demo\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
