import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">TO</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">TeamOS</p>
            <p className="text-xs leading-tight text-muted">Clients, tasks and money in one place</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Create a workspace</h1>
        <p className="mb-6 mt-1 text-sm text-muted">
          Yours alone — nobody outside it can see anything in it. You can invite people once you are in.
        </p>

        <SignupForm />

        <p className="mt-6 text-sm text-muted">
          Already have one?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
