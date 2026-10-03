import type { Metadata } from "next";
import Link from "next/link";
import { lookupLink } from "@/lib/links";
import { AuthAside, Brandmark } from "../../auth-screen";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const found = await lookupLink(token);
  const link = found.state === "valid" ? found.link : null;

  return (
    <div className="fixed inset-0 flex overflow-auto bg-canvas">
      <AuthAside />
      <div className="flex min-w-0 flex-1 px-5 py-8">
        <div className="m-auto flex w-full max-w-[400px] animate-[rise_300ms_ease] flex-col gap-5">
          <div className="wide:hidden">
            <Brandmark />
          </div>
          {link ? (
            <>
              <div>
                <h1 className="fw-s m-0 text-[26px] tracking-[-.01em]">Hi {link.member.name.split(" ")[0]}</h1>
                <p className="mt-1.5 text-sm leading-normal text-mute">
                  Set a password for <strong className="text-ink">{link.member.email}</strong> to get into {link.tenant.name}.
                </p>
              </div>
              <JoinForm token={token} />
            </>
          ) : (
            <div>
              <h1 className="fw-s m-0 text-[26px] tracking-[-.01em]">
                {found.state === "used" ? "This link was already used" : found.state === "expired" ? "This link has expired" : "This link is not valid"}
              </h1>
              <p className="mt-1.5 text-sm leading-normal text-mute">
                {found.state === "used"
                  ? "Your password is already set. Log in with it, or ask for a new link if you forgot it."
                  : "Ask whoever sent it for a new login link. They can make one from your profile on the Team screen."}
              </p>
              <p className="mt-4 text-sm">
                <Link href="/login" className="fw-s">
                  Go to log in
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
