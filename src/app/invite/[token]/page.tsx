import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Link2Off, ShieldCheck } from "lucide-react";
import { lookupInvite } from "@/lib/invitations";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept your invitation" };

/**
 * Public by design — the caller has no account yet, which is the point. The
 * token in the URL is the only thing that identifies them, so the page shows
 * nothing beyond what the person holding a valid link already knows: which
 * workspace, who invited them, and which email the account will use.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { state, invite } = await lookupInvite(token);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">OP</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">{invite?.tenantName ?? "Operations"}</p>
            <p className="text-xs leading-tight text-muted">Tasks, clients and finance in one place</p>
          </div>
        </div>

        {state === "valid" && invite ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Set your password</h1>
            <p className="mb-6 mt-1 text-sm text-muted">
              {invite.invitedByName} invited you to {invite.tenantName} as {invite.roleName}. Choose a password and you are in.
            </p>

            <div className="mb-5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Email</span>
                <span className="truncate font-medium">{invite.email}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="text-muted">Access</span>
                <span className="font-medium">
                  {invite.allClients
                    ? "All clients"
                    : `${invite.clientIds.length} ${invite.clientIds.length === 1 ? "client" : "clients"}`}
                </span>
              </div>
            </div>

            <AcceptForm token={token} defaultName={invite.name ?? ""} />

            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5 shrink-0" />
              This link works once and expires{" "}
              {invite.expiresAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.
            </p>
          </>
        ) : (
          <Dead state={state} />
        )}
      </div>
    </main>
  );
}

function Dead({ state }: { state: "expired" | "accepted" | "unknown" | "valid" }) {
  const copy = {
    expired: {
      icon: <Clock className="size-5" />,
      title: "This invitation has expired",
      body: "Invitations last 72 hours. Ask whoever invited you to send a new one — it takes them a moment.",
    },
    accepted: {
      icon: <ShieldCheck className="size-5" />,
      title: "This invitation has already been used",
      body: "Your account exists. Sign in with the email it was sent to.",
    },
    unknown: {
      icon: <Link2Off className="size-5" />,
      title: "This link is not valid",
      body: "It may have been revoked, or the address may have been copied incompletely. Check with whoever sent it.",
    },
    valid: { icon: null, title: "", body: "" },
  }[state];

  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-card">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-subtle">
        {copy.icon}
      </div>
      <p className="text-sm font-medium">{copy.title}</p>
      <p className="mt-1 text-sm text-muted">{copy.body}</p>
      <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
        Go to sign in
      </Link>
    </div>
  );
}
