import type { Metadata } from "next";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { inSignupFlow } from "@/lib/auth";
import { hashToken } from "@/lib/invitations";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * The link from the verification email.
 *
 * This page only reads. The workspace is created by the action behind the
 * button, so a link scanned by a mail client's safety checker — which fetches
 * every URL it sees — does not provision anything.
 */
export default async function VerifySignupPage({ params }: PageProps<"/signup/verify/[token]">) {
  const { token } = await params;

  const pending =
    token.length >= 16
      ? await inSignupFlow((tx) =>
          tx.pendingSignup.findUnique({
            where: { tokenHash: hashToken(token) },
            select: { email: true, name: true, workspaceName: true, expiresAt: true, claimedAt: true },
          }),
        )
      : null;

  const state = !pending
    ? "unknown"
    : pending.claimedAt
      ? "claimed"
      : pending.expiresAt < new Date()
        ? "expired"
        : "valid";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">TO</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">TeamOS</p>
            <p className="text-xs leading-tight text-muted">Clients, tasks and money in one place</p>
          </div>
        </div>

        {state === "valid" && pending ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">One more click</h1>
            <p className="mb-6 mt-1 text-sm text-muted">
              This creates {pending.workspaceName} and signs you in as its Owner.
            </p>

            <div className="mb-5 grid gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm">
              <Row label="Workspace" value={pending.workspaceName} />
              <Row label="You" value={pending.name} />
              <Row label="Email" value={pending.email} />
            </div>

            <ClaimForm token={token} workspaceName={pending.workspaceName} />

            <p className="mt-4 text-xs text-muted">
              You will get roles and a chart of accounts to edit. Brands and clients are yours to
              add — guessing at them just makes rows you have to delete.
            </p>
          </>
        ) : (
          <Dead state={state as "unknown" | "expired" | "claimed"} />
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function Dead({ state }: { state: "unknown" | "expired" | "claimed" }) {
  const copy = {
    expired: {
      title: "This link has expired",
      body: "Verification links last 24 hours. Sign up again — it takes a moment, and nothing was created the first time.",
      action: { href: "/signup", label: "Start again" },
    },
    claimed: {
      title: "This workspace already exists",
      body: "The link has been used. Sign in with the email it was sent to.",
      action: { href: "/login", label: "Go to sign in" },
    },
    unknown: {
      title: "This link is not valid",
      body: "It may have been replaced by a newer one, or copied incompletely. Signing up again sends a fresh link.",
      action: { href: "/signup", label: "Sign up" },
    },
  }[state];

  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-card">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-subtle">
        <Link2Off className="size-5" />
      </div>
      <p className="text-sm font-medium">{copy.title}</p>
      <p className="mt-1 text-sm text-muted">{copy.body}</p>
      <Link href={copy.action.href} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
        {copy.action.label}
      </Link>
    </div>
  );
}
