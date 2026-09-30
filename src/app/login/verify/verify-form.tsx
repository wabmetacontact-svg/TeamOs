"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cancelTwoFactor, verifyTwoFactor } from "./actions";

export function VerifyForm({ recoveryCount }: { recoveryCount: number }) {
  const [state, formAction, pending] = useActionState(verifyTwoFactor, null);
  const [recovery, setRecovery] = useState(false);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4">
        {state && !state.ok && !errors && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {state.error}
          </div>
        )}

        {recovery ? (
          <Field
            label="Recovery code"
            htmlFor="code"
            error={errors?.code?.[0]}
            hint={`${recoveryCount} unused ${recoveryCount === 1 ? "code" : "codes"} left. Each one works once.`}
          >
            <Input
              id="code"
              name="code"
              key="recovery"
              placeholder="A2B3C-D4E5F"
              autoComplete="one-time-code"
              className="font-mono tracking-wider"
              required
              autoFocus
            />
          </Field>
        ) : (
          <Field label="Six-digit code" htmlFor="code" error={errors?.code?.[0]}>
            <Input
              id="code"
              name="code"
              key="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              pattern="[0-9]*"
              className="text-center font-mono text-lg tracking-[0.4em]"
              required
              autoFocus
            />
          </Field>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
          Verify
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        {recoveryCount > 0 ? (
          <button type="button" onClick={() => setRecovery((v) => !v)} className="font-medium text-brand hover:underline">
            {recovery ? "Use my authenticator app" : "Use a recovery code"}
          </button>
        ) : (
          <span className="text-xs text-muted">No recovery codes left — ask an Owner to reset your two-step.</span>
        )}

        <form action={cancelTwoFactor}>
          <button type="submit" className="text-muted hover:text-fg hover:underline">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
