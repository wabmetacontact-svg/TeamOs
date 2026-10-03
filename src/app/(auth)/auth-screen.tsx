"use client";

import { useState, useTransition } from "react";
import { login, signup, type AuthResult } from "./actions";

type Mode = "login" | "signup";
type Errors = Extract<AuthResult, { ok: false }>["errors"];

/** Logo and name, as in the sidebar. */
export function Brandmark({ dark }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="fw-s flex size-[34px] items-center justify-center rounded-[9px] bg-accent text-[15px] text-white">O</span>
      <span className="flex flex-col leading-[1.2]">
        <span className={`fw-s text-[15px] ${dark ? "text-white" : "text-ink"}`}>Operations</span>
        <span className={`text-[11px] opacity-70 ${dark ? "text-white" : "text-ink"}`}>Workspace</span>
      </span>
    </div>
  );
}

/** The dark panel beside every sign-in form on wide screens. */
export function AuthAside() {
  return (
    <aside className="hidden max-w-[560px] flex-[0_0_42%] flex-col justify-between gap-8 bg-ink2 px-12 py-10 text-white wide:flex">
      <Brandmark dark />
      <div>
        <h2 className="fw-s m-0 max-w-[16ch] text-[32px] leading-[1.2] tracking-[-.02em]">
          Clients, tasks, payroll and money in one workspace.
        </h2>
        <p className="mt-4 max-w-[40ch] text-sm leading-[1.6] text-[#CBD5E1]">
          Each person sees only the sections and clients they have been given access to.
        </p>
      </div>
      <span className="text-xs text-faint">Access is managed by the workspace founder.</span>
    </aside>
  );
}

export function FieldError({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="fw-b flex items-center gap-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-bad" />
      <span className="text-bad-d">{text}</span>
    </span>
  );
}

const input = "fw-b h-[46px] rounded-[10px] border bg-white px-3.5 text-sm";
const label = "fw-s flex flex-col gap-1.5 text-xs";

function strength(pw: string) {
  const sc = +(pw.length >= 8) + +(pw.length >= 12) + +/\d/.test(pw) + +(/[A-Z]/.test(pw) && /[a-z]/.test(pw)) + +/[^A-Za-z0-9]/.test(pw);
  return {
    width: !pw ? "0%" : `${(Math.min(5, sc) / 5) * 100}%`,
    color: !pw ? "#94A3B8" : sc <= 2 ? "#DC2626" : sc === 3 ? "#D97706" : "#16A34A",
    label: !pw ? "" : sc <= 2 ? "Weak" : sc === 3 ? "Fair" : "Strong",
  };
}

export function AuthScreen({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", agree: false, remember: true });
  const [errors, setErrors] = useState<Errors>({});
  const [showPw, setShowPw] = useState(false);
  const [note, setNote] = useState("");
  const [choose, setChoose] = useState<{ tenantId: string; name: string }[]>([]);
  const [busy, start] = useTransition();

  const isLogin = mode === "login";
  const s = strength(f.password);
  const border = (k: keyof Errors) => (errors[k] ? "#DC2626" : "#E2E8F0");

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  }

  function switchTo(m: Mode) {
    setMode(m);
    setErrors({});
    setShowPw(false);
    setNote("");
    setChoose([]);
    setF((x) => ({ ...x, password: "", confirm: "" }));
    window.history.replaceState(null, "", m === "login" ? "/login" : "/signup");
  }

  function submit(tenantId?: string) {
    setNote("");
    start(async () => {
      const r = isLogin
        ? await login({ email: f.email, password: f.password, remember: f.remember, tenantId })
        : await signup({ name: f.name, email: f.email, password: f.password, confirm: f.confirm, agree: f.agree });
      // On success the action redirects; anything that returns is a refusal or a choice.
      if (!r.ok) setErrors(r.errors);
      else setChoose(r.choose);
    });
  }

  function forgot(e: React.MouseEvent) {
    e.preventDefault();
    if (!f.email.trim()) return setErrors({ email: "Enter your email first, then tap Forgot password." });
    setNote("Ask your workspace owner for a new login link. They can make one from your profile on the Team screen.");
  }

  const btn = busy ? (isLogin ? "Logging in…" : "Creating account…") : isLogin ? "Log in" : "Create account";

  return (
    <div className="fixed inset-0 z-[100] flex overflow-auto bg-canvas">
      <AuthAside />
      <div className="flex min-w-0 flex-1 px-5 py-8">
        <div className="m-auto flex w-full max-w-[400px] animate-[rise_300ms_ease] flex-col gap-5">
          <div className="wide:hidden">
            <Brandmark />
          </div>
          <div>
            <h1 className="fw-s m-0 text-[26px] tracking-[-.01em]">{isLogin ? "Log in" : "Create your account"}</h1>
            <p className="mt-1.5 text-sm leading-normal text-mute">
              {isLogin
                ? "Welcome back. Log in to your workspace."
                : "Start a new workspace. You can add your team once you are in."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-[#E9ECF2] p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchTo(m)}
                className="fw-s h-[38px] rounded-lg border-0 text-[13px]"
                style={{
                  background: mode === m ? "#fff" : "transparent",
                  color: mode === m ? "#0F172A" : "#64748B",
                  boxShadow: mode === m ? "0 1px 2px rgba(15,23,42,.1)" : "none",
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          {choose.length > 1 ? (
            <div className="flex flex-col gap-2.5 rounded-[10px] border border-edge2 bg-white p-3.5">
              <span className="text-[13px] text-mute">This email opens more than one workspace. Which one?</span>
              {choose.map((w) => (
                <button
                  key={w.tenantId}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(w.tenantId)}
                  className="fw-s h-11 rounded-[10px] border border-edge2 bg-tint text-left text-sm hover:border-accent"
                  style={{ padding: "0 14px" }}
                >
                  {w.name}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="flex flex-col gap-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              noValidate
            >
              {!isLogin && (
                <label className={label}>
                  Full name
                  <input
                    name="name"
                    autoComplete="name"
                    value={f.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Kavya Reddy"
                    className={input}
                    style={{ borderColor: border("name") }}
                  />
                  <FieldError text={errors.name} />
                </label>
              )}
              <label className={label}>
                Work email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={f.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@company.com"
                  className={input}
                  style={{ borderColor: border("email") }}
                />
                <FieldError text={errors.email} />
              </label>
              <label className={label}>
                <span className="flex items-baseline justify-between">
                  <span>Password</span>
                  {isLogin && (
                    <a href="#" onClick={forgot} className="fw-s text-xs">
                      Forgot password?
                    </a>
                  )}
                </span>
                <span className="relative block">
                  <input
                    name="password"
                    type={showPw ? "text" : "password"}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    value={f.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={isLogin ? "Your password" : "At least 8 characters"}
                    className={`${input} w-full pr-16`}
                    style={{ borderColor: border("password") }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="fw-s absolute right-1.5 top-[7px] h-8 rounded-md border-0 bg-transparent px-2.5 text-xs text-accent"
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </span>
                <FieldError text={errors.password} />
              </label>

              {!isLogin && (
                <>
                  <div className="-mt-1 flex items-center gap-2.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-sm bg-edge2">
                      <div className="h-full transition-[width] duration-200" style={{ width: s.width, background: s.color }} />
                    </div>
                    <span className="fw-s min-w-11 text-right text-[11px]" style={{ color: s.color }}>
                      {s.label}
                    </span>
                  </div>
                  <label className={label}>
                    Confirm password
                    <input
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      value={f.confirm}
                      onChange={(e) => set("confirm", e.target.value)}
                      placeholder="Type it again"
                      className={input}
                      style={{ borderColor: border("confirm") }}
                    />
                    <FieldError text={errors.confirm} />
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-normal text-ink3">
                    <input
                      type="checkbox"
                      checked={f.agree}
                      onChange={(e) => set("agree", e.target.checked)}
                      className="mt-px size-[18px] shrink-0 accent-accent"
                    />
                    <span>
                      I agree to the workspace terms and privacy policy.
                      {errors.agree && <span className="block text-xs text-bad-d">{errors.agree}</span>}
                    </span>
                  </label>
                </>
              )}

              {isLogin && (
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink3">
                  <input
                    type="checkbox"
                    checked={f.remember}
                    onChange={(e) => set("remember", e.target.checked)}
                    className="m-0 size-[18px] accent-accent"
                  />
                  Keep me signed in
                </label>
              )}

              {errors.form && <FieldError text={errors.form} />}

              <button
                type="submit"
                disabled={busy}
                className="fw-s mt-0.5 h-12 rounded-[10px] border-0 text-sm text-white hover:bg-accent-h"
                style={{ background: busy ? "#94A3B8" : "#5B5BD6" }}
              >
                {btn}
              </button>
            </form>
          )}

          {note && <div className="rounded-lg bg-[rgba(91,91,214,.07)] px-3 py-2.5 text-[13px] leading-normal text-ink3">{note}</div>}

          <p className="m-0 text-center text-[13px] text-mute">
            {isLogin ? "New here? " : "Already have an account? "}
            <a
              href="#"
              className="fw-s"
              onClick={(e) => {
                e.preventDefault();
                switchTo(isLogin ? "signup" : "login");
              }}
            >
              {isLogin ? "Create a workspace" : "Log in"}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
