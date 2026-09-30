import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tenantDb } from "@/lib/db";
import { CHALLENGE_COOKIE, verifyChallenge } from "@/lib/session";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage() {
  const challenge = await verifyChallenge((await cookies()).get(CHALLENGE_COOKIE)?.value);
  if (!challenge) redirect("/login");

  // The challenge cookie carries the tenant. Without binding to it this read
  // returns nothing and the page bounces to /login mid-sign-in.
  const user = await tenantDb(challenge.tid).user.findFirst({
    where: { id: challenge.uid },
    select: { email: true, twoFactorRecovery: true },
  });
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">OP</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">Two-step verification</p>
            <p className="truncate text-xs leading-tight text-muted">{user.email}</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Enter your code</h1>
        <p className="mb-6 mt-1 text-sm text-muted">
          Open your authenticator app and type the six digits it shows for this workspace.
        </p>

        <VerifyForm recoveryCount={user.twoFactorRecovery.length} />
      </div>
    </main>
  );
}
