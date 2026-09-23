"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isManager } from "@/lib/constants";
import { NAV, SETTINGS_ITEM, type NavItem } from "./nav";

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
        active ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-subtle")} />
      {item.label}
    </Link>
  );
}

export function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const items = NAV.filter((item) => !item.managerOnly || isManager(role));
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-15 items-center gap-2.5 px-4 py-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">TO</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">TeamOS</p>
          <p className="truncate text-[11px] leading-tight text-subtle">Tasks &amp; finance</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {items.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <NavLink item={SETTINGS_ITEM} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
