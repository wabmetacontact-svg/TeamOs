"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PRESETS, canEdit, canOverhead, grantKey, reaches, type Feature } from "@/lib/access";
import { firstLink } from "@/lib/format";
import {
  IMP,
  IMPORT_TYPES,
  MAX_IMPORT_ROWS,
  checkRows,
  type ClientRec,
  type ImportType,
  type LeaveRec,
  type LedgerRec,
  type TaskRec,
  type TeamRec,
} from "@/lib/importer";
import { mutate } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { toDate, toPaise } from "@/lib/workspace";
import { parse } from "@/lib/action-helpers";

const SECTION: Record<ImportType, Feature> = {
  tasks: "tasks",
  clients: "clients",
  team: "team",
  ledger: "expenses",
  leave: "team",
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

    const checked = checkRows(f.type, f.rows, f.map, f, {
      meId: ctx.me.id,
      today: ctx.today,
      team: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      clients: visible.map((c) => ({ id: c.id, name: c.name, company: c.company, brandId: c.brandId })),
      brands: brands.map((b) => ({ id: b.id, name: b.name })),
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
    const clientOf = async (name: string, brandId: string, extra?: Partial<Prisma.ClientUncheckedCreateInput>): Promise<string> => {
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
        await clientOf(r.name, brandId, {
          company: r.company,
          retainer: toPaise(r.retainer),
          services: r.services,
          contact: r.contact,
          sinceDate: toDate(r.since),
          currency: r.cur ?? "INR",
          ...(r.retainer > 0 ? { rates: { create: { tenantId: T, fromDate: toDate(r.since), amount: toPaise(r.retainer), currency: "INR" } } } : {}),
        });
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

    const label = IMP[f.type].label.toLowerCase();
    await ctx.log({
      kind: f.type === "tasks" ? "task" : f.type === "clients" ? "client" : f.type === "ledger" ? "expense" : "team",
      text: `imported ${imported} ${label} from ${f.fileName || "pasted rows"}`,
      target: "Import",
      area: f.type === "team" || f.type === "leave" ? "team" : "import",
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
