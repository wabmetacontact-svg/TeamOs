"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, tenantDb } from "@/lib/db";
import {
  endSession,
  hashPassword,
  resolveLoginTenants,
  spendVerificationTime,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { todayIn } from "@/lib/format";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_HR_DEPARTMENTS,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_TASK_DEPARTMENTS,
} from "@/lib/labels";
import { lookupLink } from "@/lib/links";

export type AuthResult =
  | { ok: false; errors: Partial<Record<"name" | "email" | "password" | "confirm" | "agree" | "form", string>> }
  | { ok: true; choose: { tenantId: string; name: string }[] };

const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();
const validEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e);

// ─────────────────────────────────────────────────────────────── log in ───

export async function login(input: { email: string; password: string; remember: boolean; tenantId?: string }): Promise<AuthResult> {
  const email = emailOf(input.email);
  const password = String(input.password ?? "");
  const errors: Extract<AuthResult, { ok: false }>["errors"] = {};
  if (!email) errors.email = "Enter your work email.";
  else if (!validEmail(email)) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const workspaces = await resolveLoginTenants(email);
  if (!workspaces.length) {
    await spendVerificationTime(password);
    return { ok: false, errors: { email: "No account uses this email. Sign up instead?" } };
  }

  // The same address can belong to more than one workspace; the password
  // decides which ones this person can open.
  const candidates = input.tenantId ? workspaces.filter((w) => w.tenantId === input.tenantId) : workspaces;
  const matches: { tenantId: string; name: string; memberId: string }[] = [];
  for (const w of candidates) {
    const m = await tenantDb(w.tenantId).member.findFirst({ where: { email, hrStatus: { not: "Exited" } } });
    if (m?.passwordHash && (await verifyPassword(m.passwordHash, password))) {
      matches.push({ tenantId: w.tenantId, name: w.name, memberId: m.id });
    }
  }
  if (!matches.length) return { ok: false, errors: { password: "That password is incorrect." } };
  if (matches.length > 1) return { ok: true, choose: matches.map(({ tenantId, name }) => ({ tenantId, name })) };

  const [only] = matches;
  await startSession(only!.memberId, only!.tenantId, !!input.remember);
  redirect("/dashboard");
}

// ──────────────────────────────────────────────────────────────── sign up ───

const signupForm = z.object({
  name: z.string().trim(),
  email: z.string(),
  password: z.string(),
  confirm: z.string(),
  agree: z.boolean(),
});

/**
 * Signing up creates a workspace with the new person as its owner. Teammates
 * do not sign up: an owner adds them on the Team screen and sends them a login
 * link, so nobody can join a workspace they were not invited to.
 */
export async function signup(raw: z.input<typeof signupForm>): Promise<AuthResult> {
  const f = signupForm.parse(raw);
  const email = emailOf(f.email);
  const errors: Extract<AuthResult, { ok: false }>["errors"] = {};
  if (!f.name) errors.name = "Enter your full name.";
  if (!email) errors.email = "Enter your work email.";
  else if (!validEmail(email)) errors.email = "Enter a valid email address.";
  if (f.password.length < 8) errors.password = "Use at least 8 characters.";
  if (f.confirm !== f.password) errors.confirm = "Passwords do not match.";
  if (!f.agree) errors.agree = "You need to agree before creating an account.";
  if (!errors.email && (await resolveLoginTenants(email)).length) {
    errors.email = "An account already uses this email. Log in instead.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const passwordHash = await hashPassword(f.password);
  const tenantId = randomUUID().replace(/-/g, "");
  const first = f.name.split(" ")[0] ?? f.name;
  const slug = `${first.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${randomBytes(3).toString("hex")}`;

  const memberId = await db.$transaction(async (tx) => {
    // The new workspace's id is set first, so row-level security lets exactly
    // this workspace's rows be written and no other's.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: `${first}'s workspace`,
        slug,
        incomeCategories: DEFAULT_INCOME_CATEGORIES,
        expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
        hrDepartments: DEFAULT_HR_DEPARTMENTS,
      },
    });
    await tx.taskDepartment.createMany({
      data: DEFAULT_TASK_DEPARTMENTS.map((d, i) => ({ tenantId, name: d.name, color: d.color, position: i })),
    });
    const owner = await tx.member.create({
      data: {
        tenantId,
        name: f.name,
        email,
        passwordHash,
        title: "Founder",
        isOwner: true,
        department: "Leadership",
        employmentType: "Founder",
        startDate: new Date(`${todayIn("Asia/Kolkata")}T00:00:00.000Z`),
        leaveTotal: 0,
      },
    });
    await tx.auditEntry.create({
      data: {
        tenantId,
        actorId: owner.id,
        actorName: owner.name,
        kind: "team",
        text: "created the workspace",
        target: "Team",
        area: "team",
        toValue: owner.name,
      },
    });
    return owner.id;
  });

  await startSession(memberId, tenantId, true);
  redirect("/dashboard");
}

// ─────────────────────────────────────────────────────── login links ───

/** Sets a password from a login link and signs the person in. */
export async function claimLoginLink(input: { token: string; password: string; confirm: string }): Promise<AuthResult> {
  const errors: Extract<AuthResult, { ok: false }>["errors"] = {};
  if (String(input.password ?? "").length < 8) errors.password = "Use at least 8 characters.";
  if (input.confirm !== input.password) errors.confirm = "Passwords do not match.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const found = await lookupLink(input.token);
  if (found.state !== "valid" || !found.link) {
    return {
      ok: false,
      errors: {
        form:
          found.state === "used"
            ? "This link has already been used. Log in, or ask for a new link."
            : found.state === "expired"
              ? "This link has expired. Ask whoever sent it for a new one."
              : "This link is not valid.",
      },
    };
  }

  const { link } = found;
  const passwordHash = await hashPassword(input.password);
  const claimed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${link.tenantId}, TRUE)`;
    // Conditional on still being unused, so a double submit sets it once.
    const r = await tx.loginLink.updateMany({
      where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (r.count !== 1) return false;
    await tx.member.update({ where: { id: link.memberId }, data: { passwordHash } });
    // A reset ends every other session.
    await tx.session.updateMany({ where: { memberId: link.memberId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEntry.create({
      data: {
        tenantId: link.tenantId,
        actorId: link.memberId,
        actorName: link.member.name,
        kind: "team",
        text: "set their password from a login link",
        target: "Team",
        area: "team",
      },
    });
    return true;
  });
  if (!claimed) return { ok: false, errors: { form: "This link has already been used. Log in, or ask for a new link." } };

  await startSession(link.memberId, link.tenantId, true);
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
