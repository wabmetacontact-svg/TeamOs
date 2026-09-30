"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { claimSignup } from "../../actions";

export function ClaimForm({ token, workspaceName }: { token: string; workspaceName: string }) {
  const [state, formAction, pending] = useActionState(claimSignup, null);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        Create {workspaceName}
      </Button>
    </form>
  );
}
