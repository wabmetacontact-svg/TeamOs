"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && !errors && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </div>
      )}
      <Field label="Email" htmlFor="email" error={errors?.email?.[0]}>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" error={errors?.password?.[0]}>
        <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
        Sign in
      </Button>
    </form>
  );
}
