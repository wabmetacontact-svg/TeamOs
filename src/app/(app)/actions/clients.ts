"use server";

import { z } from "zod";
import { CLIENT_LEVEL_LABEL, canEdit, clientLevel, grantKey, type ClientLevel } from "@/lib/access";
import { addDays, readAmount } from "@/lib/format";
import { mutate } from "@/lib/mutate";
import { open, seal, vaultReady } from "@/lib/vault";
import type { Result } from "@/lib/types";
import { mapBrand, mapGrant, reachOf, toDate, toPaise } from "@/lib/workspace";
import { ID, OPT_DATE, brandOf, clientOf, memberOf, needClient, outClient, parse, rs } from "@/lib/action-helpers";

const profile = z.object({
  name: z.string().trim().min(1, "Enter the client name.").max(160),
  company: z.string().trim().max(160).default(""),
  brand: z.string().min(1, "Pick a brand."),
  retainer: z.union([z.string(), z.number()]).default(""),
  sinceDate: OPT_DATE,
  payDay: z.union([z.string(), z.number()]).default(""),
  services: z.string().trim().max(1000).default(""),
  contact: z.string().trim().max(160).default(""),
});

function readRetainer(v: string | number, fail: (m: string, f: Record<string, string>) => never): number {
  if (v === "" || v == null) return 0;
  const n = readAmount(v);
  if (!Number.isFinite(n) || n < 0) fail("Enter a monthly amount in rupees.", { retainer: "Enter a monthly amount in rupees." });
  return n;
}

const payDayOf = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

export async function createClient(raw: z.input<typeof profile>): Promise<Result<{ id: string }>> {
  return mutate(async (ctx) => {
    ctx.need("clients");
    const f = parse(ctx, profile, raw);
    const brand = await brandOf(ctx, f.brand);
    const clash = await ctx.tx.client.findFirst({
      where: { removedAt: null, name: { equals: f.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) ctx.fail("A client with this name already exists.", { name: "A client with this name already exists." });
    const retainer = readRetainer(f.retainer, ctx.fail);
    const since = f.sinceDate || ctx.today;

    const client = await ctx.tx.client.create({
      data: {
        tenantId: ctx.tenantId,
        brandId: brand.id,
        name: f.name,
        company: f.company || f.name,
        retainer: toPaise(retainer),
        services: f.services,
        contact: f.contact || "Not set",
        sinceDate: toDate(since),
        payDay: payDayOf(f.payDay),
        ...(retainer > 0
          ? { rates: { create: { tenantId: ctx.tenantId, fromDate: toDate(since), amount: toPaise(retainer), currency: "INR" } } }
          : {}),
      },
    });

    // Nobody but the owners reaches a new client until somebody grants it —
    // except whoever runs the books, who keeps Finance on every client.
    // And whoever added it keeps working on it.
    const team = await ctx.tx.member.findMany({ where: { isOwner: false } });
    const grants = team
      .map((m) => {
        if (canEdit({ id: m.id, isOwner: false, features: (m.features ?? {}) as never }, "expenses")) return { m, level: "finance" };
        if (m.id === ctx.me.id) return { m, level: "edit" };
        return null;
      })
      .filter((g): g is { m: (typeof team)[number]; level: string } => !!g);
    if (grants.length) {
      await ctx.tx.clientGrant.createMany({
        data: grants.map(({ m, level }) => ({ tenantId: ctx.tenantId, memberId: m.id, clientId: client.id, level })),
      });
      ctx.upsert(
        "grants",
        grants.map(({ m, level }) => mapGrant({ memberId: m.id, clientId: client.id, level })),
      );
      const mine = grants.find((g) => g.m.id === ctx.me.id);
      if (mine) {
        ctx.reach.grants = new Map([...ctx.reach.grants, [grantKey(ctx.me.id, client.id), mine.level as "edit" | "finance"]]);
        Object.assign(ctx.reach, reachOf(ctx.person, ctx.reach.grants));
      }
    }

    await outClient(ctx, client.id);
    await ctx.log({ kind: "client", text: `added client “${f.name}”`, target: f.name, clientId: client.id, to: brand.name });
    return { message: "Client added. Grant team access from the client's Access tab.", data: { id: client.id } };
  });
}

export async function editClient(raw: z.input<typeof profile> & { id: string }): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("clients");
    const f = parse(ctx, profile.extend({ id: ID }), raw);
    const old = await clientOf(ctx, f.id);
    needClient(ctx, old.id, "edit", old.name);
    const brand = await brandOf(ctx, f.brand);
    if (old.externalSource === null && f.name.toLowerCase() !== old.name.toLowerCase()) {
      const clash = await ctx.tx.client.findFirst({
        where: { removedAt: null, id: { not: old.id }, name: { equals: f.name, mode: "insensitive" } },
      });
      if (clash) ctx.fail("A client with this name already exists.", { name: "A client with this name already exists." });
    }

    // A client mirrored from WabMeta has its name, company, contact, monthly
    // figure and start date overwritten by the next sync. Accepting an edit to
    // them here would look like it worked and quietly undo itself later, so
    // they keep their stored values and are changed in WabMeta instead. The
    // fields TeamOS owns - brand, pay day, services - still save.
    const synced = old.externalSource !== null;

    // The retainer is money: changing it needs Finance, and is kept as history.
    const fin = ctx.reach.financeClient(old.id);
    const retainer = fin && !synced ? readRetainer(f.retainer, ctx.fail) : Number(old.retainer) / 100;
    const changed = toPaise(retainer) !== old.retainer;
    if (changed) {
      const last = await ctx.tx.clientRate.findFirst({ where: { clientId: old.id, toDate: null }, orderBy: { fromDate: "desc" } });
      if (last && last.fromDate.toISOString().slice(0, 10) < ctx.today) {
        await ctx.tx.clientRate.update({ where: { id: last.id }, data: { toDate: toDate(addDays(ctx.today, -1)) } });
      } else if (last) {
        await ctx.tx.clientRate.delete({ where: { id: last.id } });
      }
      if (retainer > 0) {
        await ctx.tx.clientRate.create({
          data: { tenantId: ctx.tenantId, clientId: old.id, fromDate: toDate(ctx.today), amount: toPaise(retainer), currency: "INR" },
        });
      }
    }

    await ctx.tx.client.update({
      where: { id: old.id },
      data: {
        name: synced ? old.name : f.name,
        company: synced ? old.company : f.company,
        brandId: brand.id,
        retainer: toPaise(retainer),
        services: f.services,
        contact: synced ? old.contact : f.contact,
        sinceDate: synced ? old.sinceDate : f.sinceDate ? toDate(f.sinceDate) : old.sinceDate,
        payDay: payDayOf(f.payDay),
      },
    });
    await outClient(ctx, old.id);
    await ctx.log({
      kind: "client",
      text: `edited the profile of ${f.name}`,
      target: f.name,
      clientId: old.id,
      from: changed ? rs(Number(old.retainer) / 100) : "",
      to: changed ? rs(retainer) : "Profile updated",
    });
    return "Client profile saved.";
  });
}

// ─── the client's account ──────────────────────────────────────────────────

const account = z.object({
  id: ID,
  details: z.string().max(5000).default(""),
  loginId: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
});

/**
 * Notes about the client, and - for a client added here - its login and phone.
 *
 * For a synced client the login and phone come from WabMeta and the next sync
 * would overwrite them, so only the notes are taken. Needs Edit on the client.
 */
export async function saveClientAccount(raw: z.input<typeof account>): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("clients");
    const f = parse(ctx, account, raw);
    const c = await clientOf(ctx, f.id);
    needClient(ctx, c.id, "edit", c.name);
    const synced = c.externalSource !== null;

    await ctx.tx.client.update({
      where: { id: c.id },
      data: {
        details: f.details,
        ...(!synced && f.loginId !== undefined && { loginId: f.loginId }),
        ...(!synced && f.phone !== undefined && { phone: f.phone }),
      },
    });
    await outClient(ctx, c.id);
    await ctx.log({ kind: "client", text: `updated the account details of ${c.name}`, target: c.name, clientId: c.id });
    return "Account details saved.";
  });
}

const PASSWORD = z.object({ id: ID, password: z.string().min(1, "Enter the password.").max(200) });

/**
 * Only an owner may store, read or remove a client's password, and every one
 * of those is written to the audit trail - without the password. Reading it
 * goes through mutate too, so it is refused while an owner is previewing
 * somebody else's access and is logged in the same transaction it happens in.
 */
function ownerOnly(ctx: Parameters<Parameters<typeof mutate>[0]>[0]) {
  if (!ctx.person.isOwner) ctx.fail("Only an owner can see or change a client's password.");
  if (!vaultReady()) ctx.fail("Passwords cannot be stored yet: CLIENT_VAULT_KEY is not set on the server.");
}

export async function setClientPassword(raw: z.input<typeof PASSWORD>): Promise<Result> {
  return mutate(async (ctx) => {
    ownerOnly(ctx);
    const f = parse(ctx, PASSWORD, raw);
    const c = await clientOf(ctx, f.id);
    await ctx.tx.client.update({
      where: { id: c.id },
      data: { passwordEnc: seal(f.password), passwordSetAt: new Date() },
    });
    await outClient(ctx, c.id);
    await ctx.log({
      kind: "client",
      text: c.passwordEnc ? `changed the stored login password of ${c.name}` : `stored a login password for ${c.name}`,
      target: c.name,
      clientId: c.id,
    });
    return "Password stored, encrypted.";
  });
}

export async function revealClientPassword(id: string): Promise<Result<{ password: string }>> {
  return mutate(async (ctx) => {
    ownerOnly(ctx);
    const c = await clientOf(ctx, id);
    if (!c.passwordEnc) ctx.fail("No password is stored for this client.");
    const password = open(c.passwordEnc!);
    await ctx.log({ kind: "client", text: `viewed the login password of ${c.name}`, target: c.name, clientId: c.id });
    return { data: { password } };
  });
}

export async function clearClientPassword(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ownerOnly(ctx);
    const c = await clientOf(ctx, id);
    await ctx.tx.client.update({ where: { id: c.id }, data: { passwordEnc: null, passwordSetAt: null } });
    await outClient(ctx, c.id);
    await ctx.log({ kind: "client", text: `removed the stored login password of ${c.name}`, target: c.name, clientId: c.id });
    return "Password removed.";
  });
}

export async function removeClient(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    ctx.need("clients");
    if (!ctx.person.isOwner) ctx.fail("Only an owner can remove a client.");
    const c = await clientOf(ctx, id);
    await ctx.tx.client.update({ where: { id }, data: { removedAt: new Date() } });
    ctx.remove("clients", [id]);
    await ctx.log({ kind: "client", text: `removed client “${c.name}”`, target: c.name, clientId: id, from: "Active", to: "Removed" });
    return `${c.name} removed.`;
  });
}

// ────────────────────────────────────────────────────────── client access ───

const grantInput = z.object({ memberId: ID, clientId: ID, level: z.enum(["none", "view", "edit", "finance"]) });

export async function setGrant(raw: z.input<typeof grantInput>): Promise<Result> {
  return mutate(async (ctx) => {
    if (!ctx.person.isOwner) ctx.fail("Only an owner can change who reaches a client.");
    const { memberId, clientId, level } = parse(ctx, grantInput, raw);
    const [m, c] = await Promise.all([memberOf(ctx, memberId), clientOf(ctx, clientId)]);
    if (m.isOwner) ctx.fail("An owner always has full access.");

    const from: ClientLevel = clientLevel({ id: m.id, isOwner: false, features: {} }, c.id, ctx.reach.grants);
    if (from === level) return;
    if (level === "none") {
      await ctx.tx.clientGrant.deleteMany({ where: { memberId, clientId } });
      ctx.remove("grants", [grantKey(memberId, clientId)]);
    } else {
      await ctx.tx.clientGrant.upsert({
        where: { memberId_clientId: { memberId, clientId } },
        create: { tenantId: ctx.tenantId, memberId, clientId, level },
        update: { level },
      });
      ctx.upsert("grants", [mapGrant({ memberId, clientId, level })]);
    }
    await ctx.log({
      kind: "access",
      text: `changed access for ${m.name}`,
      target: c.name,
      clientId: c.id,
      from: CLIENT_LEVEL_LABEL[from],
      to: CLIENT_LEVEL_LABEL[level],
    });
    return `${m.name} now has ${CLIENT_LEVEL_LABEL[level]} on ${c.name}.`;
  });
}

// ───────────────────────────────────────────────────────────────── brands ───

const STARTUP_AREAS = ["Social Media", "Tech", "Ops"];

export async function addBrand(raw: { name: string; kind?: string }): Promise<Result<{ id: string }>> {
  return mutate(async (ctx) => {
    const may = ["clients", "tasks", "expenses", "team"].some((f) => canEdit(ctx.person, f as never));
    if (!may) ctx.fail("You need Edit access somewhere in the workspace to add a brand.");
    const { name, kind } = parse(
      ctx,
      z.object({ name: z.string().trim().min(1, "Enter a name.").max(80), kind: z.enum(["agency", "startup"]).default("agency") }),
      raw,
    );
    const clash = await ctx.tx.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (clash) ctx.fail("That brand already exists.");
    const b = await ctx.tx.brand.create({
      data: { tenantId: ctx.tenantId, name, kind, areas: kind === "startup" ? STARTUP_AREAS : [] },
    });
    ctx.upsert("brands", [mapBrand(b)]);
    await ctx.log({ kind: "client", text: `added brand “${name}”`, target: "Brands", area: "brands", to: name });
    return { message: `${name} added.`, data: { id: b.id } };
  });
}

export async function removeBrand(id: string): Promise<Result> {
  return mutate(async (ctx) => {
    if (!ctx.person.isOwner) ctx.fail("Only an owner can remove a brand.");
    const b = await brandOf(ctx, id);
    const total = await ctx.tx.brand.count();
    if (total <= 1) ctx.fail("Keep at least one brand.");
    const [nc, nt] = await Promise.all([
      ctx.tx.client.count({ where: { brandId: id, removedAt: null } }),
      ctx.tx.task.count({ where: { brandId: id } }),
    ]);
    if (nc || nt) {
      const used = [nc && `${nc} ${nc === 1 ? "client" : "clients"}`, nt && `${nt} ${nt === 1 ? "task" : "tasks"}`].filter(Boolean).join(" and ");
      ctx.fail(`${b.name} is used by ${used}. Move them to another brand first.`);
    }
    const removedClients = await ctx.tx.client.count({ where: { brandId: id } });
    if (removedClients) ctx.fail(`${b.name} still holds the history of removed clients, so it is kept.`);
    await ctx.tx.member.updateMany({ where: { brandId: id }, data: { brandId: null } });
    await ctx.tx.brand.delete({ where: { id } });
    ctx.remove("brands", [id]);
    await ctx.log({ kind: "client", text: `removed the brand “${b.name}”`, target: b.name, area: "brands", from: b.name });
    return `${b.name} removed.`;
  });
}
