import Link from "next/link";
import { Search } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { can } from "@/lib/scope";
import { NotificationBell } from "@/components/app/notification-bell";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, scope } = await requireScope();

  // Fetched here rather than polled from the client: the bell is on every
  // page anyway, so this costs one query on a render that was happening.
  const [notifications, unread] = await Promise.all([listNotifications(scope, 8), unreadCount(scope)]);

  // Modules appear as they are built, and only for people whose role can open
  // them — a link to a page that would refuse you is a link that lies.
  const nav = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/tasks", label: "Tasks", show: can(scope, "task:view") },
    { href: "/clients", label: "Clients", show: can(scope, "client:view") },
    { href: "/ledger", label: "Ledger", show: can(scope, "expense:view") },
    { href: "/team", label: "Team", show: can(scope, "user:view") },
    // The `people` table is external humans; the two are not the same list.
    { href: "/people", label: "Directory", show: can(scope, "person:view") },
    { href: "/pipelines", label: "Pipelines", show: can(scope, "relationship:view") },
    { href: "/brands", label: "Brands", show: can(scope, "settings:view") },
    // Your own account, so nothing gates it.
    { href: "/security", label: "Security", show: true },
    { href: "/audit", label: "Audit", show: can(scope, "audit:view") },
  ].filter((item) => item.show);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">OP</span>
          <span className="text-sm font-semibold">{user.tenantName}</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href="/search"
            aria-label="Search"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Search className="size-4" />
          </Link>

          <NotificationBell
            unread={unread}
            items={notifications.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              link: n.link,
              readAt: n.readAt?.toISOString() ?? null,
              createdAt: n.createdAt.toISOString(),
            }))}
          />

          <span className="ml-1.5 hidden text-right sm:block">
            <span className="block text-[13px] font-medium leading-tight">{user.name}</span>
            <span className="block text-[11px] leading-tight text-muted">{user.roleName}</span>
          </span>
          <form action={logoutAction}>
            <Button size="sm" variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
