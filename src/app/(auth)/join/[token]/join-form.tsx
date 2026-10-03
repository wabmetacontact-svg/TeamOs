"use client";

import { useState, useTransition } from "react";
import { claimLoginLink, type AuthResult } from "../../actions";
import { FieldError } from "../../auth-screen";

type Errors = Extract<AuthResult, { ok: false }>["errors"];

export function JoinForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3.5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await claimLoginLink({ token, password, confirm });
          if (!r.ok) setErrors(r.errors);
        });
      }}
    >
      <label className="fw-s flex flex-col gap-1.5 text-xs">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors({});
          }}
          placeholder="At least 8 characters"
          className="fw-b h-[46px] rounded-[10px] border bg-white px-3.5 text-sm"
          style={{ borderColor: errors.password ? "#DC2626" : "#E2E8F0" }}
        />
        <FieldError text={errors.password} />
      </label>
      <label className="fw-s flex flex-col gap-1.5 text-xs">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErrors({});
          }}
          placeholder="Type it again"
          className="fw-b h-[46px] rounded-[10px] border bg-white px-3.5 text-sm"
          style={{ borderColor: errors.confirm ? "#DC2626" : "#E2E8F0" }}
        />
        <FieldError text={errors.confirm} />
      </label>
      <FieldError text={errors.form} />
      <button
        type="submit"
        disabled={busy}
        className="fw-s mt-0.5 h-12 rounded-[10px] border-0 text-sm text-white hover:bg-accent-h"
        style={{ background: busy ? "#94A3B8" : "#5B5BD6" }}
      >
        {busy ? "Saving…" : "Set password and continue"}
      </button>
    </form>
  );
}
