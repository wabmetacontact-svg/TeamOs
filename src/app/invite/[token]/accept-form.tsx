"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { acceptInvitation } from "../actions";

export function AcceptForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && !errors && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Field label="Your name" htmlFor="name" error={errors?.name?.[0]} required>
        <Input id="name" name="name" defaultValue={defaultName} autoComplete="name" placeholder="Priya Sharma" required autoFocus />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={errors?.password?.[0]}
        hint="At least 10 characters. Length does more than punctuation here."
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>

      <Field label="Confirm password" htmlFor="confirm" error={errors?.confirm?.[0]}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
        Create my account
      </Button>
    </form>
  );
}
