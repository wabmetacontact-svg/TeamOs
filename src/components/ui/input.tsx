import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg shadow-card outline-none transition placeholder:text-subtle focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-surface-2 disabled:text-muted aria-invalid:border-[var(--red)]";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(base, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(base, "min-h-20 resize-y py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(base, "h-9 appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-fg", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-[var(--red)]">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--red)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
