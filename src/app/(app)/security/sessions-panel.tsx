"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOutEverywhereElse } from "./actions";

type Session = { id: string; userAgent: string | null; ip: string | null; createdAt: string };

export function SessionsPanel({ sessions, currentSessionId }: { sessions: Session[]; currentSessionId: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const others = sessions.filter((s) => s.id !== currentSessionId).length;

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {sessions.map((session) => {
          const mine = session.id === currentSessionId;
          const mobile = /mobile|android|iphone/i.test(session.userAgent ?? "");
          return (
            <li key={session.id} className="flex items-center gap-2.5 text-sm">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-subtle">
                {mobile ? <Smartphone className="size-3.5" /> : <Laptop className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">{describe(session.userAgent)}</p>
                <p className="truncate text-xs text-muted">
                  {session.ip ?? "unknown address"} · since{" "}
                  {new Date(session.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
              </div>
              {mine && <Badge tone="blue">This device</Badge>}
            </li>
          );
        })}
      </ul>

      {note && <p className="text-sm text-muted">{note}</p>}

      <Button
        variant="secondary"
        size="sm"
        className="justify-self-start"
        disabled={others === 0}
        loading={pending}
        onClick={() =>
          start(async () => {
            const result = await signOutEverywhereElse();
            setNote(result.ok ? (result.message ?? null) : result.error);
          })
        }
      >
        {others === 0 ? "No other sessions" : `Sign out ${others} other ${others === 1 ? "session" : "sessions"}`}
      </Button>
    </div>
  );
}

/** A user-agent string is not meant to be read by people; this is the part of
 *  it someone can actually recognise as their own machine. */
function describe(ua: string | null): string {
  if (!ua) return "Unknown device";

  const browser =
    /edg\//i.test(ua) ? "Edge"
    : /chrome|crios/i.test(ua) ? "Chrome"
    : /firefox|fxios/i.test(ua) ? "Firefox"
    : /safari/i.test(ua) ? "Safari"
    : "Browser";

  const platform =
    /windows/i.test(ua) ? "Windows"
    : /iphone|ipad/i.test(ua) ? "iOS"
    : /android/i.test(ua) ? "Android"
    : /mac os/i.test(ua) ? "macOS"
    : /linux/i.test(ua) ? "Linux"
    : "";

  return platform ? `${browser} on ${platform}` : browser;
}
