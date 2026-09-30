"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes } from "./actions";

type Step = { name: "idle" } | { name: "scanning"; uri: string; secret: string } | { name: "codes"; codes: string[] };

export function TwoFactorPanel({
  enabled,
  required,
  roleName,
  addedAt,
  recoveryRemaining,
}: {
  enabled: boolean;
  required: boolean;
  roleName: string;
  addedAt: string | null;
  recoveryRemaining: number;
}) {
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<void>) {
    setError(null);
    start(fn);
  }

  if (step.name === "codes") {
    return <RecoveryCodes codes={step.codes} onDone={() => setStep({ name: "idle" })} />;
  }

  if (step.name === "scanning") {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          Scan this in Google Authenticator, 1Password, Authy or any app that does six-digit codes, then type what it
          shows.
        </p>

        {/* Rendered from the otpauth:// URI in the browser, so the secret is
            never handed to an image service. */}
        <QrCode uri={step.uri} />

        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-fg">Can&apos;t scan it?</summary>
          <p className="mt-2">Type this key into your app instead:</p>
          <code className="mt-1 block break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-fg">
            {step.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        </details>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        <form
          action={(formData) =>
            run(async () => {
              const result = await confirmTwoFactorSetup({ code: String(formData.get("code") ?? "") });
              if (result.ok) setStep({ name: "codes", codes: result.data?.recoveryCodes ?? [] });
              else setError(result.error);
            })
          }
          className="grid gap-3"
        >
          <Field label="Code from your app" htmlFor="setup-code">
            <Input
              id="setup-code"
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className="text-center font-mono text-lg tracking-[0.4em]"
              required
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={pending}>
              Turn it on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep({ name: "idle" })}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted">
          {required
            ? `Required for ${roleName}s. Until it is on, your password is the only thing between this workspace and anyone who learns it.`
            : "Optional, and worth the minute it takes. A password can be guessed or reused; a code on your phone cannot."}
        </p>
        {error && <p className="text-sm text-[var(--red)]">{error}</p>}
        <Button
          variant="primary"
          loading={pending}
          className="justify-self-start"
          onClick={() =>
            run(async () => {
              const result = await beginTwoFactorSetup();
              if (result.ok && result.data) setStep({ name: "scanning", ...result.data });
              else if (!result.ok) setError(result.error);
            })
          }
        >
          <KeyRound />
          Set up two-step
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="text-sm">
        <p>
          On since{" "}
          {addedAt ? new Date(addedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "recently"}.
        </p>
        <p className={recoveryRemaining <= 2 ? "mt-1 text-[var(--red)]" : "mt-1 text-muted"}>
          {recoveryRemaining} recovery {recoveryRemaining === 1 ? "code" : "codes"} left
          {recoveryRemaining <= 2 && " — generate a new set before you run out"}.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <PasswordAction
        label="New recovery codes"
        hint="Your current codes stop working the moment the new ones appear."
        submitLabel="Generate new codes"
        pending={pending}
        onSubmit={(password) =>
          run(async () => {
            const result = await regenerateRecoveryCodes({ password });
            if (result.ok) setStep({ name: "codes", codes: result.data?.recoveryCodes ?? [] });
            else setError(result.error);
          })
        }
      />

      {required ? (
        <p className="text-xs text-muted">
          Two-step cannot be turned off for {roleName}s. If you need to move it to a new phone, generate recovery codes
          first.
        </p>
      ) : (
        <PasswordAction
          label="Turn two-step off"
          hint="You will be back to a password alone."
          submitLabel="Turn it off"
          danger
          pending={pending}
          onSubmit={(password) =>
            run(async () => {
              const result = await disableTwoFactor({ password });
              if (!result.ok) setError(result.error);
            })
          }
        />
      )}
    </div>
  );
}

/** Anything destructive asks for the password again, because a session cookie
 *  is exactly what someone at a borrowed laptop already has. */
function PasswordAction({
  label,
  hint,
  submitLabel,
  danger,
  pending,
  onSubmit,
}: {
  label: string;
  hint: string;
  submitLabel: string;
  danger?: boolean;
  pending: boolean;
  onSubmit: (password: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`justify-self-start text-sm font-medium hover:underline ${danger ? "text-[var(--red)]" : "text-brand"}`}
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={(formData) => onSubmit(String(formData.get("password") ?? ""))}
      className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3"
    >
      <Field label="Confirm your password" htmlFor={`pw-${label}`} hint={hint}>
        <Input id={`pw-${label}`} name="password" type="password" autoComplete="current-password" required autoFocus />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
        Save these now. They are not stored anywhere you can read them again, and each one works once.
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-surface-2 p-3 font-mono text-[13px]">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={copied ? "primary" : "secondary"}
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} className="ml-auto">
          I have saved them
        </Button>
      </div>
    </div>
  );
}

function QrCode({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);

  // Imported on demand so the QR library is not in the bundle for the many
  // page loads that never reach setup.
  if (!src) {
    void import("qrcode").then(({ default: QR }) =>
      QR.toDataURL(uri, { margin: 1, width: 232, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc("")),
    );
  }

  return (
    <div className="flex justify-center rounded-lg border border-border bg-white p-3">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI; next/image would round-trip it through the optimiser for nothing
        <img src={src} alt="Two-factor setup QR code" width={232} height={232} />
      ) : (
        <div className="size-[232px] animate-pulse rounded bg-surface-2" />
      )}
    </div>
  );
}
