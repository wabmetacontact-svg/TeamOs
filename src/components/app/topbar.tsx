"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog as D } from "radix-ui";
import { DropdownMenu as M } from "radix-ui";
import { LogOut, Menu, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/card";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { logoutAction } from "@/app/login/actions";
import { SidebarNav } from "./sidebar";

export function Topbar({ user }: { user: { name: string; email: string; role: string } }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 sm:px-6">
      <D.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <D.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
            <Menu />
          </Button>
        </D.Trigger>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-slate-900/30 animate-fade lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-surface shadow-pop focus:outline-none lg:hidden">
            <D.Title className="sr-only">Menu</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <SidebarNav role={user.role} onNavigate={() => setMenuOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <span className="text-sm font-medium lg:hidden">TeamOS</span>

      <div className="ml-auto flex items-center gap-2">
        <M.Root>
          <M.Trigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-hover" aria-label="Account">
            <Avatar name={user.name} />
            <span className="hidden text-left sm:block">
              <span className="block text-[13px] font-medium leading-tight">{user.name}</span>
              <span className="block text-[11px] leading-tight text-muted">{ROLE_LABELS[user.role as Role] ?? user.role}</span>
            </span>
          </M.Trigger>
          <M.Portal>
            <M.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-52 rounded-xl border border-border bg-surface p-1 shadow-pop animate-in"
            >
              <M.Label className="px-2 py-1.5">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </M.Label>
              <M.Separator className="my-1 h-px bg-border" />
              <M.Item asChild>
                <Link
                  href="/settings"
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-muted"
                >
                  <User /> My profile
                </Link>
              </M.Item>
              <M.Item asChild>
                <Link
                  href="/settings"
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-muted"
                >
                  <Settings /> Settings
                </Link>
              </M.Item>
              <M.Separator className="my-1 h-px bg-border" />
              <M.Item
                onSelect={() => logoutAction()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-rose-600 outline-none data-[highlighted]:bg-rose-50 [&_svg]:size-4"
              >
                <LogOut /> Sign out
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      </div>
    </header>
  );
}
