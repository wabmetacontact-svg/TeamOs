"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager, requireUser } from "@/lib/auth";
import { CATEGORY_COLORS, CATEGORY_KINDS, ROLES } from "@/lib/constants";
import { toActionError, UserError, type ActionResult } from "@/lib/action-result";

function done() {
  revalidatePath("/", "layout");
}

// ------------------------------------------------------------------ team ---

const memberSchema = z.object({
  name: z.string().trim().min(2, "Name is required.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(ROLES),
  designation: z.string().trim().max(80).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export type MemberInput = z.input<typeof memberSchema>;

export async function addMember(raw: MemberInput): Promise<ActionResult> {
  try {
    await requireManager();
    const input = memberSchema.parse(raw);
    if (await db.user.findUnique({ where: { email: input.email } })) {
      throw new UserError("Someone already uses that email.");
    }
    await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        designation: input.designation || null,
        passwordHash: await bcrypt.hash(input.password, 10),
      },
    });
    done();
    return { ok: true, message: `${input.name} can now sign in` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateMember(
  id: string,
  raw: { role?: string; active?: boolean; designation?: string; password?: string },
): Promise<ActionResult> {
  try {
    const me = await requireManager();
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new UserError("Member not found.");

    const data: { role?: string; active?: boolean; designation?: string | null; passwordHash?: string } = {};

    if (raw.role !== undefined) {
      if (!ROLES.includes(raw.role as (typeof ROLES)[number])) throw new UserError("Pick a valid role.");
      if (id === me.id) throw new UserError("You can't change your own role.");
      data.role = raw.role;
    }
    if (raw.active !== undefined) {
      if (id === me.id) throw new UserError("You can't deactivate yourself.");
      data.active = raw.active;
    }
    if (raw.designation !== undefined) data.designation = raw.designation || null;
    if (raw.password) {
      if (raw.password.length < 8) throw new UserError("Password must be at least 8 characters.");
      data.passwordHash = await bcrypt.hash(raw.password, 10);
    }

    await db.user.update({ where: { id }, data });
    done();
    return { ok: true, message: "Member updated" };
  } catch (err) {
    return toActionError(err);
  }
}

// ------------------------------------------------------------ categories ---

export async function saveCategory(raw: { id?: string; name: string; kind: string; color: string }): Promise<ActionResult> {
  try {
    await requireManager();
    const input = z
      .object({
        id: z.string().optional(),
        name: z.string().trim().min(2, "Name is too short").max(40),
        kind: z.enum(CATEGORY_KINDS),
        color: z.enum(CATEGORY_COLORS),
      })
      .parse(raw);

    const clash = await db.category.findFirst({ where: { name: input.name, NOT: input.id ? { id: input.id } : undefined } });
    if (clash) throw new UserError("That name is already used.");

    if (input.id) {
      await db.category.update({ where: { id: input.id }, data: { name: input.name, kind: input.kind, color: input.color } });
    } else {
      await db.category.create({ data: { name: input.name, kind: input.kind, color: input.color } });
    }
    done();
    return { ok: true, message: "Saved" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<ActionResult> {
  try {
    await requireManager();
    await db.category.update({ where: { id }, data: { archived } });
    done();
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// --------------------------------------------------------------- profile ---

export async function updateProfile(raw: { name: string; phone?: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const input = z.object({ name: z.string().trim().min(2, "Name is required").max(80), phone: z.string().trim().max(30).optional() }).parse(raw);
    await db.user.update({ where: { id: user.id }, data: { name: input.name, phone: input.phone || null } });
    done();
    return { ok: true, message: "Profile updated" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function changePassword(raw: { current: string; next: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const input = z
      .object({ current: z.string().min(1, "Enter your current password"), next: z.string().min(8, "New password must be at least 8 characters") })
      .parse(raw);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(input.current, row.passwordHash))) throw new UserError("Current password is incorrect.");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.next, 10) } });
    return { ok: true, message: "Password changed" };
  } catch (err) {
    return toActionError(err);
  }
}
