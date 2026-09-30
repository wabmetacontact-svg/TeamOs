"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRAND_COLORS } from "@/lib/ui-enums";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { fieldDefsSchema, readFieldDefs } from "@/lib/custom-fields";
import { NotFoundError } from "@/lib/scope";


const nameField = z.string().trim().min(1, "A brand needs a name").max(60);

export const createBrand = defineAction({
  permission: "settings:edit",
  input: z.object({ name: nameField, color: z.enum(BRAND_COLORS).default("blue") }),
  async handler(ctx, input) {
    if (await ctx.db.brand.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
      throw new UserError(`${input.name} already exists.`);
    }

    const brand = await ctx.db.brand.create({
      data: { tenantId: ctx.user.tenantId, name: input.name, color: input.color, fieldDefs: [] },
    });

    await ctx.audit({
      action: "created",
      resourceType: "Brand",
      resourceId: brand.id,
      resourceLabel: brand.name,
      after: { name: brand.name },
    });

    revalidatePath("/brands");
    revalidatePath("/clients");
    return { ok: true, data: { id: brand.id }, message: `${brand.name} added.` } satisfies ActionResult<{ id: string }>;
  },
});

export const renameBrand = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1), name: nameField, color: z.enum(BRAND_COLORS) }),
  async handler(ctx, input) {
    const brand = await ctx.db.brand.findUnique({ where: { id: input.id } });
    if (!brand) throw new NotFoundError();

    const clash = await ctx.db.brand.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, id: { not: input.id } },
    });
    if (clash) throw new UserError(`${input.name} already exists.`);

    await ctx.db.brand.update({ where: { id: input.id }, data: { name: input.name, color: input.color } });

    if (brand.name !== input.name || brand.color !== input.color) {
      await ctx.audit({
        action: "updated",
        resourceType: "Brand",
        resourceId: brand.id,
        resourceLabel: input.name,
        before: { name: brand.name, color: brand.color },
        after: { name: input.name, color: input.color },
      });
    }

    revalidatePath("/brands");
    revalidatePath("/clients");
    return { ok: true, message: "Saved." } satisfies ActionResult;
  },
});

/**
 * Editing a brand's field definitions.
 *
 * Two rules the form cannot enforce on its own, so they live here:
 *
 * A key is immutable once it exists. The key is what every client's stored
 * values are keyed on; renaming it would orphan all of them silently, which is
 * the worst kind of data loss — nothing errors, the values simply stop being
 * found. Changing the label is free and is what people actually want.
 *
 * A type is immutable once it exists, for the same reason one level down: a
 * number field turned into a multiselect leaves every stored value the wrong
 * shape, and validateCustomFields would reject each client on its next save.
 *
 * Removing a field is allowed, and the caller is told how many clients hold a
 * value for it first — see `fieldUsage`.
 */
export const updateBrandFields = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1), fieldDefs: z.unknown() }),
  async handler(ctx, input) {
    const brand = await ctx.db.brand.findUnique({ where: { id: input.id } });
    if (!brand) throw new NotFoundError();

    const parsed = fieldDefsSchema.safeParse(input.fieldDefs);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (fieldErrors[issue.path.join(".") || "fields"] ??= []).push(issue.message);
      }
      throw new UserError("Some field definitions need attention.", "invalid", fieldErrors);
    }

    const before = readFieldDefs(brand.fieldDefs);
    const byKey = new Map(before.map((d) => [d.key, d]));

    for (const def of parsed.data) {
      const existing = byKey.get(def.key);
      if (existing && existing.type !== def.type) {
        throw new UserError(
          `"${existing.label}" is already a ${existing.type} field. Changing the type would leave every stored value the wrong shape — remove it and add a new field instead.`,
        );
      }
    }

    await ctx.db.brand.update({ where: { id: input.id }, data: { fieldDefs: parsed.data } });

    const removed = before.filter((d) => !parsed.data.some((n) => n.key === d.key)).map((d) => d.label);
    const added = parsed.data.filter((d) => !byKey.has(d.key)).map((d) => d.label);

    await ctx.audit({
      action: "fields_updated",
      resourceType: "Brand",
      resourceId: brand.id,
      resourceLabel: brand.name,
      before: { fields: before.map((d) => `${d.label} (${d.type})`) },
      after: { fields: parsed.data.map((d) => `${d.label} (${d.type})`), added, removed },
    });

    revalidatePath("/brands");
    revalidatePath("/clients");

    return {
      ok: true,
      message: removed.length
        ? `Saved. ${removed.join(", ")} will no longer appear on this brand's clients.`
        : "Saved.",
    } satisfies ActionResult;
  },
});

/**
 * How many of this brand's clients hold a value for each field key. Shown
 * before a field is removed, because "remove" on a definition is a decision
 * about other people's data and the form should say how much.
 */
export const fieldUsage = defineAction({
  permission: "settings:view",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const clients = await ctx.db.client.findMany({
      where: { brandId: input.id, deletedAt: null },
      select: { customFields: true },
    });

    const counts: Record<string, number> = {};
    for (const client of clients) {
      const values = (client.customFields ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) {
        const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
        if (!empty) counts[key] = (counts[key] ?? 0) + 1;
      }
    }

    return { ok: true, data: { counts, clients: clients.length } } satisfies ActionResult<{
      counts: Record<string, number>;
      clients: number;
    }>;
  },
});

/** Deleting a brand is refused while any client sits under it. */
export const deleteBrand = defineAction({
  permission: "settings:edit",
  input: z.object({ id: z.string().min(1) }),
  async handler(ctx, input) {
    const brand = await ctx.db.brand.findUnique({ where: { id: input.id } });
    if (!brand) throw new NotFoundError();

    const [clients, categories, tasks] = await Promise.all([
      ctx.db.client.count({ where: { brandId: input.id, deletedAt: null } }),
      ctx.db.category.count({ where: { brandId: input.id } }),
      ctx.db.task.count({ where: { brandId: input.id } }),
    ]);

    if (clients > 0) {
      throw new UserError(
        `${brand.name} still has ${clients} ${clients === 1 ? "client" : "clients"}. Move them to another brand first.`,
      );
    }

    // Categories and tasks reference the brand with SetNull, so they survive —
    // but losing which brand a task belonged to is a real loss, so it is said
    // out loud rather than discovered later.
    await ctx.db.brand.delete({ where: { id: input.id } });

    await ctx.audit({
      action: "deleted",
      resourceType: "Brand",
      resourceId: brand.id,
      resourceLabel: brand.name,
      before: { name: brand.name, categories, tasks },
    });

    revalidatePath("/brands");
    revalidatePath("/clients");
    return {
      ok: true,
      message:
        categories + tasks > 0
          ? `${brand.name} deleted. ${categories + tasks} categories and tasks kept their data but lost the brand label.`
          : `${brand.name} deleted.`,
    } satisfies ActionResult;
  },
});
