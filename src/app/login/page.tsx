import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">TO</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">TeamOS</p>
            <p className="text-xs leading-tight text-muted">Tasks and finance in one place</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Use the email your manager set up for you.</p>

        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </main>
  );
}
