"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PRESETS, canEdit, canOverhead, grantKey, reaches, type Feature } from "@/lib/access";
import { MNF, daysInMonth, firstLink } from "@/lib/format";
import {
  IMP,
  IMPORT_TYPES,
  MAX_IMPORT_ROWS,
  adKey,
  checkRows,
  ledgerKey,
  type AdRec,
  type ClientRec,
  type ImportType,
  type LeaveRec,
  type LedgerRec,
  type TaskRec,
  type TeamRec,
} from "@/lib/importer";
import { mutate } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { asPerson, toDate, toPaise } from "@/lib/workspace";
import { getSigned } from "@/lib/auth";
import { parse } from "@/lib/action-helpers";

const SECTION: Record<ImportType, Feature> = {
  tasks: "tasks",
  clients: "clients",
  team: "team",
  ledger: "expenses",
  leave: "team",
  ads: "ads",
};

const input = z.object({
  type: z.enum(IMPORT_TYPES as [ImportType, ...ImportType[]]),
  fileName: z.string().max(200).default(""),
  rows: z.array(z.array(z.string().max(5000)).max(200)).max(MAX_IMPORT_ROWS),
  map: z.record(z.string(), z.string()),
  mkClients: z.boolean().default(true),
  mkMembers: z.boolean().default(false),
});

const id = () => randomUUID().replace(/-/g, "");

export type ImportOutcome = { n: number; skipped: number; extra: string[] };

/**
 * Imports checked rows. The browser previewed them; this checks them again
 * against the database and the caller's access before writing anything, and
 * writes them all in one transaction.
 */
export async function runImport(raw: z.input<typeof input>): Promise<Result<ImportOutcome>> {
  return mutate(async (ctx) => {
    ctx.need("import");
    const f = parse(ctx, input, raw);
    ctx.need(SECTION[f.type]);
    const tx = ctx.tx;
    const T = ctx.tenantId;

    const [members, clients, brands, depts, tenant] = await Promise.all([
      tx.member.findMany(),
      tx.client.findMany({ where: { removedAt: null } }),
      tx.brand.findMany({ orderBy: { createdAt: "asc" } }),
      tx.taskDepartment.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      tx.tenant.findUniqueOrThrow({ where: { id: T } }),
    ]);
    const visible = clients.filter((c) => ctx.reach.visibleClient(c.id));

    // What is already recorded, so a sheet imported twice is not counted twice.
    const ledgerKeys =
      f.type === "ledger"
        ? new Set(
            (await tx.ledgerEntry.findMany({ select: { type: true, date: true, amount: true, clientId: true, description: true } })).map((e) =>
              ledgerKey({ type: e.type, date: e.date.toISOString().slice(0, 10), paise: Number(e.amount), clientId: e.clientId, desc: e.description }),
            ),
          )
        : undefined;
    const adKeys =
      f.type === "ads"
        ? new Set(
            (await tx.adSpend.findMany({ select: { memberId: true, month: true, amount: true, leads: true } })).map((a) =>
              adKey({ memberId: a.memberId, month: a.month.toISOString().slice(0, 7), paise: Number(a.amount), leads: a.leads }),
            ),
          )
        : undefined;

    const checked = checkRows(f.type, f.rows, f.map, f, {
      meId: ctx.me.id,
      today: ctx.today,
      team: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      clients: visible.map((c) => ({ id: c.id, name: c.name, company: c.company, brandId: c.brandId })),
      brands: brands.map((b) => ({ id: b.id, name: b.name })),
      ledgerKeys,
      adKeys,
    });
    const ready = checked.filter((r) => r.ok && r.rec);
    if (!ready.length) ctx.fail("No rows are ready to import.");

    const made = { clients: 0, people: 0, brands: 0 };
    const canPayroll = canEdit(ctx.person, "payroll");

    // ── created as rows reference them
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));
    const brandOf = async (name: string | null): Promise<string> => {
      if (!name) {
        if (brands[0]) return brands[0].id;
        return brandOf("Main brand");
      }
      const hit = brandByName.get(name.toLowerCase());
      if (hit) return hit;
      const b = await tx.brand.create({ data: { tenantId: T, name, kind: "agency" } });
      brandByName.set(name.toLowerCase(), b.id);
      brands.push(b);
      made.brands++;
      return b.id;
    };

    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c]));
    const clientBrand = (cid: string) => [...clientByName.values()].find((c) => c.id === cid)?.brandId ?? null;
    const financeTeam = members.filter((m) => !m.isOwner && canEdit({ id: m.id, isOwner: false, features: (m.features ?? {}) as never }, "expenses"));
    // `assigned` are the people credited with the client - its seller and
    // onboarder. They get Edit on it, as the WabMeta sync gives them.
    const clientOf = async (name: string, brandId: string, extra?: Partial<Prisma.ClientUncheckedCreateInput>, assigned: string[] = []): Promise<string> => {
      const hit = clientByName.get(name.toLowerCase());
      if (hit) {
        if (!ctx.reach.visibleClient(hit.id)) ctx.fail(`A client called “${name}” exists but you have no access to it. Ask an owner.`);
        return hit.id;
      }
      const c = await tx.client.create({
        data: { tenantId: T, name, company: name, brandId, contact: "Not set", sinceDate: toDate(ctx.today), ...extra },
      });
      clientByName.set(name.toLowerCase(), c);
      made.clients++;
      const grants = [
        ...financeTeam.map((m) => ({ memberId: m.id, level: "finance" })),
        ...(!ctx.person.isOwner && !financeTeam.some((m) => m.id === ctx.me.id) ? [{ memberId: ctx.me.id, level: "edit" }] : []),
      ];
      for (const mid of new Set(assigned)) {
        const who = members.find((m) => m.id === mid);
        if (who && !who.isOwner && !grants.some((g) => g.memberId === mid)) grants.push({ memberId: mid, level: "edit" });
      }
      if (grants.length) await tx.clientGrant.createMany({ data: grants.map((g) => ({ tenantId: T, clientId: c.id, ...g })) });
      for (const g of grants) (ctx.reach.grants as Map<string, string>).set(grantKey(g.memberId, c.id), g.level);
      return c.id;
    };

    const memberByName = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));
    const memberOf = async (r: Pick<TeamRec, "name"> & Partial<TeamRec>): Promise<string> => {
      const hit = memberByName.get(r.name.toLowerCase());
      if (hit) return hit;
      const start = r.start || ctx.today;
      const salary = canPayroll && r.salary ? toPaise(r.salary) : null;
      const pay = canPayroll && r.pay ? r.pay : null;
      const m = await tx.member.create({
        data: {
          tenantId: T,
          name: r.name,
          email: r.email || null,
          title: r.role || "Team member",
          features: PRESETS.Member,
          department: r.dept || "Operations",
          brandId: brands[0]?.id ?? null,
          employmentType: r.type || "Full-time",
          startDate: toDate(start),
          hrStatus: r.type === "Intern" || r.type === "Contract" ? "Probation" : "Active",
          salary,
          leaveTotal: r.type === "Intern" ? 6 : 18,
          phone: r.phone || null,
          managerId: ctx.me.id,
          ...(pay
            ? pay.method === "upi"
              ? { payMethod: "upi", payUpi: pay.upi }
              : { payMethod: "bank", payHolder: pay.holder, payBank: pay.bank, payAccount: pay.acct, payIfsc: pay.ifsc }
            : {}),
          ...(salary ? { salaryChanges: { create: { tenantId: T, effectiveFrom: toDate(start), amount: salary } } } : {}),
        },
      });
      memberByName.set(r.name.toLowerCase(), m.id);
      members.push(m);
      made.people++;
      return m.id;
    };

    let imported = 0;
    const skipped: string[] = [];

    if (f.type === "tasks") {
      const limit = !ctx.person.isOwner && ctx.person.taskDeptIds.length ? ctx.person.taskDeptIds : null;
      const dept = depts.find((d) => !limit || limit.includes(d.id));
      if (!dept) ctx.fail("Add a task department first.");
      const tasks: Prisma.TaskCreateManyInput[] = [];
      const changes: Prisma.TaskStatusChangeCreateManyInput[] = [];
      const notes: Prisma.TaskNoteCreateManyInput[] = [];
      for (const { rec } of ready) {
        const r = rec as TaskRec;
        const brandId = r.newBrand ? await brandOf(r.newBrand) : r.brand;
        const clientId = r.newClient ? await clientOf(r.newClient, brandId ?? (await brandOf(null))) : r.client;
        if (clientId && !reaches(ctx.person, clientId, "edit", ctx.reach.grants)) {
          skipped.push(r.title);
          continue;
        }
        const who = r.newWho ? await memberOf({ name: r.newWho }) : r.who;
        const b = brandId ?? (clientId ? clientBrand(clientId) : null) ?? (await brandOf(null));
        const taskId = id();
        tasks.push({
          id: taskId,
          tenantId: T,
          title: r.title,
          brandId: b,
          clientId,
          assigneeId: who,
          assignedById: ctx.me.id,
          status: r.status,
          departmentId: dept!.id,
          due: r.due ? toDate(r.due) : null,
          priority: r.pri,
          estimate: r.est,
          createdOn: toDate(r.created),
        });
        changes.push({ tenantId: T, taskId, status: "todo", at: new Date(`${r.created}T09:00:00Z`), byId: ctx.me.id });
        if (r.status !== "todo") {
          const day = r.status === "done" && r.due && r.due < ctx.today ? r.due : r.created;
          changes.push({ tenantId: T, taskId, status: r.status, at: new Date(`${day}T17:00:00Z`), byId: who });
        }
        if (r.note) notes.push({ tenantId: T, taskId, byId: ctx.me.id, at: new Date(`${r.created}T09:00:00Z`), text: r.note, link: firstLink(r.note) || null });
        imported++;
      }
      await tx.task.createMany({ data: tasks });
      await tx.taskStatusChange.createMany({ data: changes });
      if (notes.length) await tx.taskNote.createMany({ data: notes });
    }

    if (f.type === "clients") {
      for (const { rec } of ready) {
        const r = rec as ClientRec;
        const brandId = r.newBrand ? await brandOf(r.newBrand) : (r.brand ?? (await brandOf(null)));
        const seller = r.newSeller ? await memberOf({ name: r.newSeller }) : r.seller;
        const onboarder = r.newOnboarder ? await memberOf({ name: r.newOnboarder }) : r.onboarder;
        await clientOf(
          r.name,
          brandId,
          {
          company: r.company,
          retainer: toPaise(r.retainer),
          services: r.services,
          contact: r.contact,
          sinceDate: toDate(r.since),
          currency: r.cur ?? "INR",
          ...(r.retainer > 0 ? { rates: { create: { tenantId: T, fromDate: toDate(r.since), amount: toPaise(r.retainer), currency: "INR" } } } : {}),
            ownerMemberId: seller,
            onboarderMemberId: onboarder,
            loginId: r.loginId,
            phone: r.phone,
            details: r.details,
          },
          [seller, onboarder].filter((x): x is string => !!x),
        );
        imported++;
      }
    }

    if (f.type === "team") {
      for (const { rec } of ready) {
        await memberOf(rec as TeamRec);
        imported++;
      }
    }

    if (f.type === "ledger") {
      const entries: Prisma.LedgerEntryCreateManyInput[] = [];
      const inc = new Set(tenant.incomeCategories);
      const exp = new Set(tenant.expenseCategories);
      for (const { rec } of ready) {
        const r = rec as LedgerRec;
        const clientId = r.newClient ? await clientOf(r.newClient, await brandOf(null)) : r.client;
        const allowed = clientId ? reaches(ctx.person, clientId, "finance", ctx.reach.grants) : canOverhead(ctx.person);
        const payrollOnly = !clientId && (r.cat === "Salaries" || r.cat === "Partner draw") && !canPayroll;
        if (!allowed || payrollOnly) {
          skipped.push(r.desc);
          continue;
        }
        entries.push({
          tenantId: T,
          type: r.type,
          date: toDate(r.date),
          description: r.desc,
          clientId,
          category: r.cat,
          amount: toPaise(r.amount),
          status: r.status,
          currency: r.cur,
          origAmount: r.orig != null ? toPaise(r.orig) : null,
          memberId: r.member,
          createdById: ctx.me.id,
        });
        (r.type === "in" ? inc : exp).add(r.cat);
        imported++;
      }
      await tx.ledgerEntry.createMany({ data: entries });
      await tx.tenant.update({ where: { id: T }, data: { incomeCategories: [...inc], expenseCategories: [...exp] } });
    }

    if (f.type === "leave") {
      const leaves: Prisma.LeaveCreateManyInput[] = ready.map(({ rec }) => {
        const r = rec as LeaveRec;
        return { tenantId: T, memberId: r.who, type: r.type, fromDate: toDate(r.from), toDate: toDate(r.to), note: r.note, status: r.status };
      });
      await tx.leave.createMany({ data: leaves });
      imported = leaves.length;
    }

    if (f.type === "ads") {
      // As recording one by hand does: the spend is an expense under Ads, in
      // its month, and the ad spend row points at it.
      const exp = new Set(tenant.expenseCategories);
      for (const { rec } of ready) {
        const r = rec as AdRec;
        const who = members.find((m) => m.id === r.who)!;
        let ledgerEntryId: string | null = null;
        if (r.amount > 0) {
          const day = r.month === ctx.today.slice(0, 7) ? ctx.today : `${r.month}-${String(Math.min(28, daysInMonth(r.month))).padStart(2, "0")}`;
          const e = await tx.ledgerEntry.create({
            data: {
              tenantId: T,
              type: "out",
              date: toDate(day),
              description: `Ads for ${who.name}, ${MNF[Number(r.month.slice(5)) - 1]}${r.note ? ` - ${r.note}` : ""}`,
              category: "Ads",
              amount: toPaise(r.amount),
              status: "paid",
              memberId: who.id,
              createdById: ctx.me.id,
            },
          });
          ledgerEntryId = e.id;
          exp.add("Ads");
        }
        await tx.adSpend.create({
          data: { tenantId: T, memberId: who.id, month: toDate(`${r.month}-01`), amount: toPaise(r.amount), leads: r.leads, note: r.note, ledgerEntryId, createdById: ctx.me.id },
        });
        imported++;
      }
      if (exp.size !== tenant.expenseCategories.length) await tx.tenant.update({ where: { id: T }, data: { expenseCategories: [...exp] } });
    }

    const label = IMP[f.type].label.toLowerCase();
    await ctx.log({
      kind: f.type === "tasks" ? "task" : f.type === "clients" ? "client" : f.type === "ledger" || f.type === "ads" ? "expense" : "team",
      text: `imported ${imported} ${label} from ${f.fileName || "pasted rows"}`,
      target: "Import",
      area: f.type === "team" || f.type === "leave" ? "team" : f.type === "ads" ? "ledger" : "import",
      to: `${imported} rows`,
    });

    const extra = [
      made.clients && `${made.clients} new client${made.clients > 1 ? "s" : ""}`,
      made.people && f.type !== "team" && `${made.people} new team member${made.people > 1 ? "s" : ""}`,
      made.brands && `${made.brands} new brand${made.brands > 1 ? "s" : ""}`,
    ].filter((x): x is string => !!x);

    return {
      message: `Imported ${imported} ${label}.`,
      data: { n: imported, skipped: f.rows.length - imported, extra },
    };
  }, { timeout: 120_000 });
}

const SHEET_ID = /^[a-zA-Z0-9_-]{20,100}$/;

/**
 * A Google Sheet shared as "anyone with the link", read as CSV. Done here
 * rather than in the browser, which Google refuses to answer across origins.
 * Only Google's own export URL is ever requested, built from the sheet id, so
 * this cannot be pointed anywhere else. No transaction: it only reads from
 * Google, and holding a database connection through a download is waste.
 */
export async function readSheetLink(raw: { url: string }): Promise<Result<{ text: string }>> {
  const signed = await getSigned();
  if (!signed) return { ok: false, error: "Your session has ended. Please log in again." };
  if (signed.previewing || !canEdit(asPerson(signed.me), "import")) return { ok: false, error: "Importing needs Edit access on Import." };
  const url = String(raw?.url ?? "");
  const sheetId = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!sheetId || !SHEET_ID.test(sheetId)) return { ok: false, error: "Paste a Google Sheets link, the one from your browser address bar." };
  const gid = url.match(/[#&?]gid=(\d{1,15})/)?.[1];
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  }).catch(() => null);
  const text = res?.ok ? await res.text() : "";
  if (!text || /^\s*</.test(text)) {
    return { ok: false, error: "Couldn't read that sheet. Share it as Anyone with the link can view, or download it as CSV or Excel and upload the file." };
  }
  if (text.length > 8_000_000) return { ok: false, error: "That sheet is too big to read at once. Split it, or upload it as a file." };
  return { ok: true, data: { text } };
}
