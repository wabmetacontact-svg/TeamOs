"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { FEATURE_IDS, LEVEL_LABEL, PRESETS, featureLevel, featureName, type Feature, type Features, type Level } from "@/lib/access";
import { PREVIEW_COOKIE, getSigned } from "@/lib/auth";
import { mutate, type Ctx } from "@/lib/mutate";
import type { Result } from "@/lib/types";
import { asPerson } from "@/lib/workspace";
import { ID, memberOf, outMember, parse } from "@/lib/action-helpers";

async function target(ctx: Ctx, memberId: string) {
  ctx.need("access");
  const m = await memberOf(ctx, memberId);
  if (m.isOwner) ctx.fail("An owner always has full access.");
  if (m.id === ctx.me.id) ctx.fail("You cannot change your own access. Ask an owner.");
  return m;
}

export async function setFeature(raw: { memberId: string; feature: string; level: string }): Promise<Result> {
  return mutate(async (ctx) => {
    const { memberId, feature, level } = parse(
      ctx,
      z.object({ memberId: ID, feature: z.enum(FEATURE_IDS as [Feature, ...Feature[]]), level: z.enum(["none", "view", "edit"]) }),
      raw,
    );
    const m = await target(ctx, memberId);
    const from = featureLevel(asPerson(m), feature);
    if (from === level) return;
    const features: Features = { ...((m.features ?? {}) as Features), [feature]: level as Level };
    await ctx.tx.member.update({ where: { id: m.id }, data: { features } });
    await outMember(ctx, m.id);
    const name = featureName(feature);
    await ctx.log({
      kind: "access",
      text: `changed ${name} access for ${m.name}`,
      target: "Access",
      area: "access",
      from: LEVEL_LABEL[from],
      to: LEVEL_LABEL[level as Level],
    });
    return `${m.name}: ${name} set to ${LEVEL_LABEL[level as Level]}.`;
  });
}

export async function applyPreset(raw: { memberId: string; preset: string }): Promise<Result> {
  return mutate(async (ctx) => {
    const { memberId, preset } = parse(ctx, z.object({ memberId: ID, preset: z.string() }), raw);
    const levels = PRESETS[preset];
    if (!levels) return ctx.fail("That preset does not exist.");
    const m = await target(ctx, memberId);
    await ctx.tx.member.update({ where: { id: m.id }, data: { features: levels } });
    await outMember(ctx, m.id);
    await ctx.log({ kind: "access", text: `applied the ${preset} preset to ${m.name}`, target: "Access", area: "access", from: "Custom", to: preset });
    return `${preset} preset applied to ${m.name}.`;
  });
}

/**
 * "Viewing as": an owner sees the workspace through someone else's access, to
 * check what they can reach. Read only — every write refuses while it is on.
 */
export async function setPreview(memberId: string | null): Promise<Result> {
  const signed = await getSigned();
  if (!signed) return { ok: false, error: "Your session has ended. Please log in again." };
  if (!signed.me.isOwner) return { ok: false, error: "Only an owner can view the workspace as someone else." };
  const jar = await cookies();
  if (!memberId || memberId === signed.me.id) {
    jar.delete(PREVIEW_COOKIE);
    return { ok: true };
  }
  jar.set(PREVIEW_COOKIE, memberId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return { ok: true };
}
