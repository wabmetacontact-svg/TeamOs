"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [, start] = useTransition();

  useEffect(() => {
    if (q === initial) return;
    const timer = setTimeout(() => {
      start(() => router.replace(q.trim() ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false }));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        placeholder="A client, a person, a payee, a reference…"
        className="h-11 pl-9 text-base"
        aria-label="Search everything"
        autoFocus
      />
    </div>
  );
}
