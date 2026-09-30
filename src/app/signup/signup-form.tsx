"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Copy, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { resendVerification, signUp } from "./actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, null);
  const [email, setEmail] = useState("");

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  // The success screen. Nothing has been created yet — that happens when the
  // link is clicked — so this says so rather than implying a workspace exists.
  if (state?.ok) return <Sent email={email} link={state.data?.link} message={state.message} />;

  return (
    <form action={formAction} className="grid gap-4">
      {state && !state.ok && !errors && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Field
        label="Workspace name"
        htmlFor="workspaceName"
        error={errors?.workspaceName?.[0]}
        hint="Your company or agency. You can change it later."
        required
      >
        <Input id="workspaceName" name="workspaceName" placeholder="Hephaestus" required autoFocus />
      </Field>

      <Field label="Your name" htmlFor="name" error={errors?.name?.[0]} required>
        <Input id="name" name="name" autoComplete="name" placeholder="Sameer Thakur" required />
      </Field>

      <Field
        label="Work email"
        htmlFor="email"
        error={errors?.email?.[0]}
        hint="You will get a link here to confirm it is yours."
        required
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={errors?.password?.[0]}
        hint="At least 10 characters. Length does more than punctuation."
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>

      <Field label="Confirm password" htmlFor="confirm" error={errors?.confirm?.[0]}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
        Create workspace
      </Button>

      <p className="text-xs text-muted">
        Nothing is created until you confirm the email. As the first person in, you will be the Owner — and two-step
        verification is required for that role.
      </p>
    </form>
  );
}

function Sent({ email, link, message }: { email: string; link?: string; message?: string }) {
  const [resent, formAction, pending] = useActionState(resendVerification, null);
  const [copied, setCopied] = useState(false);

  const shownLink = (resent?.ok ? resent.data?.link : undefined) ?? link;

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-medium">{shownLink ? "Here is your link" : "Check your email"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {shownLink
              ? "No mail provider is set up on this install, so the link is below instead of in your inbox."
              : `Sent to ${email}. The link works once and expires in 24 hours.`}
          </p>
        </div>
      </div>

      {shownLink && (
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Input readOnly value={shownLink} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button
              type="button"
              variant={copied ? "primary" : "secondary"}
              size="icon"
              aria-label="Copy link"
              onClick={async () => {
                await navigator.clipboard.writeText(shownLink);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <Button variant="primary" asChild className="w-full">
            <a href={shownLink}>Open it and finish setting up</a>
          </Button>
        </div>
      )}

      {message && !shownLink && <p className="text-sm text-muted">{message}</p>}

      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="email" value={email} />
        <Button type="submit" variant="ghost" size="sm" loading={pending}>
          Send it again
        </Button>
        {resent && !resent.ok && <span className="text-xs text-[var(--red)]">{resent.error}</span>}
        {resent?.ok && !resent.data?.link && <span className="text-xs text-muted">{resent.message}</span>}
      </form>
    </div>
  );
}
