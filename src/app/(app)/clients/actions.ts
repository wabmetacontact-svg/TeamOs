"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CLIENT_STATUSES } from "@/lib/ui-enums";
import { defineAction, UserError, type ActionContext, type ActionResult } from "@/lib/action";
import { clientDependencies, getClient } from "@/lib/clients";
import { readFieldDefs, validateCustomFields } from "@/lib/custom-fields";
import { NotFoundError } from "@/lib/scope";


const baseFields = {
  name: z.string().trim().min(1, "A client needs a name").max(120),
  legalName: z.string().trim().max(160).optional(),
  brandId: z.string().min(1, "Choose a brand"),
  subTag: z.string().trim().max(60).optional(),
  status: z.enum(CLIENT_STATUSES),
  billingCurrency: z.string().trim().length(3, "Use a three-letter code").toUpperCase(),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
};

/**
 * Custom fields belong to the brand, not to the client, so they cannot be
 * validated by the schema alone — the rules are a row in another table. This
 * loads that row and turns any failures into the same shape Zod produces, so
 * the form shows brand-defined and built-in errors together.
 */
async function checkCustomFields(ctx: ActionContext, brandId: string, input: Record<string, unknown>) {
  const brand = await ctx.db.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new UserError("That brand no longer exists.", "not_found");

  const { values, errors } = validateCustomFields(readFieldDefs(brand.fieldDefs), input);
  if (Object.keys(errors).length) throw new UserError("Some fields need attention.", "invalid", errors);

  return values;
}

export const createClient = defineAction({
  permission: "client:create",
  input: z.object(baseFields),
  async handler(ctx, input) {
    // A Manager who cannot see every client should not be able to create one
    // they then cannot open. Assigning it to themselves is the coherent move.
    const duplicate = await ctx.db.client.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, brandId: input.brandId, deletedAt: null },
    });
    if (duplicate) throw new UserError(`${input.name} already exists under that brand.`);

    const customFields = await checkCustomFields(ctx, input.brandId, input.customFields);

    const client = await ctx.db.client.create({
      data: {
        tenantId: ctx.user.tenantId,
        name: input.name,
        legalName: input.legalName || null,
        brandId: input.brandId,
        subTag: input.subTag || null,
        status: input.status,
        billingCurrency: input.billingCurrency,
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
        notes: input.notes || null,
        customFields,
      },
    });

    // Assignment grants scope, and this is the case where it matters most:
    // without it the creator would immediately lose sight of what they made.
    if (!ctx.scope.allClients) {
      await ctx.db.userClientScope.create({
        data: { tenantId: ctx.user.tenantId, userId: ctx.user.id, clientId: client.id },
      });
    }

    await ctx.audit({
      action: "created",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      after: { name: client.name, status: client.status, subTag: client.subTag },
    });

    revalidatePath("/clients");
    return { ok: true, data: { id: client.id }, message: `${client.name} added.` } satisfies ActionResult<{ id: string }>;
  },
});

export const updateClient = defineAction({
  permission: "client:edit",
  input: z.object({ id: z.string().min(1), ...baseFields }),
  async handler(ctx, input) {
    // Through getClient, so an out-of-scope id is a 404 here exactly as it is
    // on the page — the edit route is not a way around the read rules.
    const before = await getClient(ctx.scope, input.id);

    if (before.status !== "Archived" && input.status === "Archived") {
      throw new UserError("Use Archive so the reason is recorded.", "invalid");
    }

    const customFields = await checkCustomFields(ctx, input.brandId, input.customFields);

    const after = await ctx.db.client.update({
      where: { id: input.id },
      data: {
        name: input.name,
        legalName: input.legalName || null,
        brandId: input.brandId,
        subTag: input.subTag || null,
        status: input.status,
        billingCurrency: input.billingCurrency,
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
        notes: input.notes || null,
        customFields,
      },
    });

    // Only what actually moved. An audit entry that lists every field on every
    // save is an audit entry nobody reads.
    const changed = diff(
      { name: before.name, legalName: before.legalName, brandId: before.brandId, subTag: before.subTag, status: before.status, billingCurrency: before.billingCurrency, notes: before.notes, customFields: before.customFields },
      { name: after.name, legalName: after.legalName, brandId: after.brandId, subTag: after.subTag, status: after.status, billingCurrency: after.billingCurrency, notes: after.notes, customFields: after.customFields },
    );

    if (changed) {
      await ctx.audit({
        action: "updated",
        resourceType: "Client",
        resourceId: after.id,
        resourceLabel: after.name,
        before: changed.before,
        after: changed.after,
      });
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${input.id}`);
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

/**
 * Archiving, which is what almost everyone means when they say delete. The
 * client stops appearing in the working list and everything attached to it
 * stays exactly where it is.
 */
export const archiveClient = defineAction({
  permission: "client:archive",
  input: z.object({ id: z.string().min(1), reason: z.string().trim().max(300).optional() }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.id);
    if (client.status === "Archived") throw new UserError(`${client.name} is already archived.`);

    await ctx.db.client.update({ where: { id: input.id }, data: { status: "Archived" } });

    await ctx.audit({
      action: "archived",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      before: { status: client.status },
      after: { status: "Archived", reason: input.reason || null },
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${input.id}`);
    return { ok: true, message: `${client.name} archived. Nothing attached to it was touched.` } satisfies ActionResult;
  },
});

export const restoreClient = defineAction({
  permission: "client:archive",
  input: z.object({ id: z.string().min(1), status: z.enum(["Active", "Paused", "Onboarding"]).default("Active") }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.id);
    if (client.status !== "Archived") throw new UserError(`${client.name} is not archived.`);

    await ctx.db.client.update({ where: { id: input.id }, data: { status: input.status } });
    await ctx.audit({
      action: "restored",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      before: { status: "Archived" },
      after: { status: input.status },
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${input.id}`);
    return { ok: true, message: `${client.name} is ${input.status.toLowerCase()} again.` } satisfies ActionResult;
  },
});

/**
 * Real deletion, and it is refused whenever anything financial hangs off the
 * client. This is not caution for its own sake: the money is the one thing in
 * this application that has to reconcile against a sheet somebody else keeps,
 * and a deleted client takes its transactions' context with it.
 */
export const deleteClient = defineAction({
  permission: "client:delete",
  input: z.object({ id: z.string().min(1), confirmName: z.string().trim().min(1) }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.id);

    if (input.confirmName.toLowerCase() !== client.name.toLowerCase()) {
      throw new UserError("The name does not match. Type it exactly to confirm.");
    }

    const { counts, total } = await clientDependencies(ctx.scope, input.id);
    if (total > 0) {
      const parts = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([what, n]) => `${n} ${what.replace(/([A-Z])/g, " $1").toLowerCase().trim()}`);
      throw new UserError(
        `${client.name} still has ${parts.join(", ")}. Archive it instead — that hides it without losing any of this.`,
      );
    }

    // Soft delete: every query in clients.ts already filters deletedAt, and the
    // row stays available to the audit trail, which references it by id.
    await ctx.db.client.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

    await ctx.audit({
      action: "deleted",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      before: { name: client.name, brandId: client.brandId, status: client.status },
    });

    revalidatePath("/clients");
    return { ok: true, message: `${client.name} deleted.` } satisfies ActionResult;
  },
});

// ─────────────────────────────────────────────── assignment grants scope ───

export const assignUserToClient = defineAction({
  permission: "client:edit",
  input: z.object({ clientId: z.string().min(1), userId: z.string().min(1) }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.clientId);
    const user = await ctx.db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, allClients: true } });
    if (!user) throw new NotFoundError();

    if (user.allClients) throw new UserError(`${user.name} already sees every client.`);

    await ctx.db.userClientScope.upsert({
      where: { userId_clientId: { userId: user.id, clientId: client.id } },
      create: { tenantId: ctx.user.tenantId, userId: user.id, clientId: client.id },
      update: {},
    });

    await ctx.audit({
      action: "access_granted",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      after: { user: user.name, userId: user.id },
    });

    revalidatePath(`/clients/${input.clientId}`);
    // No session is touched: their scope is read on every request, so this is
    // in force the moment they load their next page.
    return { ok: true, message: `${user.name} can now see ${client.name}.` } satisfies ActionResult;
  },
});

export const removeUserFromClient = defineAction({
  permission: "client:edit",
  input: z.object({ clientId: z.string().min(1), userId: z.string().min(1) }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.clientId);
    const user = await ctx.db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundError();

    // Removing your own last route to a client would hide it from you mid-edit.
    if (user.id === ctx.user.id && !ctx.scope.allClients) {
      throw new UserError("Removing your own access would hide this client from you. Ask someone else to do it.");
    }

    const removed = await ctx.db.userClientScope.deleteMany({ where: { userId: user.id, clientId: client.id } });
    if (removed.count === 0) throw new UserError(`${user.name} was not assigned to ${client.name}.`, "not_found");

    await ctx.audit({
      action: "access_revoked",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      before: { user: user.name, userId: user.id },
    });

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, message: `${user.name} no longer sees ${client.name}.` } satisfies ActionResult;
  },
});

// ───────────────────────────────────────────────────────────── contacts ───

export const addClientContact = defineAction({
  permission: "client:edit",
  input: z.object({
    clientId: z.string().min(1),
    name: z.string().trim().min(1, "A contact needs a name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional(),
    title: z.string().trim().max(80).optional(),
    isPrimary: z.boolean().default(false),
  }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.clientId);

    // One person, many clients: the same human turning up at a second client is
    // the same row, not a copy. Stage 2 makes the dedupe rule a database
    // constraint; this is the half of it that matters today.
    const existing = input.email
      ? await ctx.db.person.findFirst({ where: { email: input.email, deletedAt: null } })
      : null;

    const person =
      existing ??
      (await ctx.db.person.create({
        data: { tenantId: ctx.user.tenantId, name: input.name, email: input.email || null, phone: input.phone || null },
      }));

    if (await ctx.db.clientContact.findUnique({ where: { clientId_personId: { clientId: client.id, personId: person.id } } })) {
      throw new UserError(`${person.name} is already a contact for ${client.name}.`);
    }

    if (input.isPrimary) {
      await ctx.db.clientContact.updateMany({ where: { clientId: client.id, isPrimary: true }, data: { isPrimary: false } });
    }

    await ctx.db.clientContact.create({
      data: {
        tenantId: ctx.user.tenantId,
        clientId: client.id,
        personId: person.id,
        title: input.title || null,
        isPrimary: input.isPrimary,
      },
    });

    await ctx.audit({
      action: "contact_added",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      after: { person: person.name, email: person.email, title: input.title || null },
    });

    revalidatePath(`/clients/${input.clientId}`);
    return {
      ok: true,
      message: existing ? `${person.name} was already on file and is now linked here too.` : `${person.name} added.`,
    } satisfies ActionResult;
  },
});

export const removeClientContact = defineAction({
  permission: "client:edit",
  input: z.object({ clientId: z.string().min(1), personId: z.string().min(1) }),
  async handler(ctx, input) {
    const client = await getClient(ctx.scope, input.clientId);
    const contact = await ctx.db.clientContact.findUnique({
      where: { clientId_personId: { clientId: client.id, personId: input.personId } },
      include: { person: { select: { name: true } } },
    });
    if (!contact) throw new NotFoundError();

    // Only the link goes. The person may be a contact elsewhere, or have a
    // relationship of their own.
    await ctx.db.clientContact.delete({
      where: { clientId_personId: { clientId: client.id, personId: input.personId } },
    });

    await ctx.audit({
      action: "contact_removed",
      resourceType: "Client",
      resourceId: client.id,
      resourceLabel: client.name,
      before: { person: contact.person.name },
    });

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, message: `${contact.person.name} removed from ${client.name}.` } satisfies ActionResult;
  },
});

/** The fields that actually moved, or null when nothing did. */
function diff<T extends Record<string, unknown>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  let any = false;

  for (const key of Object.keys(before) as (keyof T)[]) {
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
    b[key] = before[key];
    a[key] = after[key];
    any = true;
  }

  return any ? { before: b, after: a } : null;
}
