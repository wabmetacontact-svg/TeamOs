"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-slate-900/30 animate-fade" />
      <D.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-2xl border border-border bg-surface shadow-pop animate-in focus:outline-none",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[7vh] sm:max-h-[86vh] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-2xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
