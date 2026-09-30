"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { markAllRead } from "@/app/(app)/notifications-actions";

type Item = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Unread count and the last few, in the header.
 *
 * Rendered from data the layout already fetched rather than polling. A bell
 * that polls every thirty seconds is a query per user per thirty seconds,
 * forever, for information nobody is waiting on that urgently — and on a
 * serverless deployment it is a bill.
 */
export function NotificationBell({ items, unread }: { items: Item[]; unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away, as a button so a keyboard can escape it too. */}
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    start(async () => {
                      await markAllRead();
                      router.refresh();
                    })
                  }
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="scrollbar-thin max-h-80 divide-y divide-border overflow-y-auto">
                {items.map((item) => {
                  const body = (
                    <>
                      <p className={`truncate text-sm ${item.readAt ? "text-muted" : "font-medium"}`}>{item.title}</p>
                      {item.body && <p className="truncate text-xs text-muted">{item.body}</p>}
                      <p className="mt-0.5 text-[11px] text-subtle">
                        {new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </>
                  );

                  return (
                    <li key={item.id}>
                      {item.link ? (
                        <Link
                          href={item.link}
                          onClick={() => setOpen(false)}
                          className="block px-3 py-2 hover:bg-surface-hover"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="px-3 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
