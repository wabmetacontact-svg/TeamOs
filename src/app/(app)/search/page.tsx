import type { Metadata } from "next";
import Link from "next/link";
import { Building2, GitBranch, Receipt, SearchX, SquareCheck, Users } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { searchEverything, type SearchHit } from "@/lib/search";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Search" };

const ICONS: Record<SearchHit["type"], React.ReactNode> = {
  client: <Building2 className="size-4" />,
  person: <Users className="size-4" />,
  task: <SquareCheck className="size-4" />,
  transaction: <Receipt className="size-4" />,
  relationship: <GitBranch className="size-4" />,
};

const LABELS: Record<SearchHit["type"], string> = {
  client: "Clients",
  person: "People",
  task: "Tasks",
  transaction: "Ledger",
  relationship: "Relationships",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";

  const results = await searchEverything(scope, query, {
    baseCurrency: user.baseCurrency,
    timeZone: user.timezone,
  });

  // Grouped rather than interleaved: a flat list ranked across five entity
  // types needs a relevance score nobody would trust, and the type is usually
  // what somebody already knows.
  const grouped = new Map<SearchHit["type"], SearchHit[]>();
  for (const hit of results.hits) {
    grouped.set(hit.type, [...(grouped.get(hit.type) ?? []), hit]);
  }

  return (
    <>
      <PageHeader
        title="Search"
        description="Clients, people, tasks, ledger entries and relationships — as far as you can reach, and no further."
      />

      <SearchBox initial={query} />

      {query.trim().length < 2 ? (
        <Card className="mt-4">
          <EmptyState
            title="Type at least two characters"
            description="One character matches most of the workspace and tells you nothing."
          />
        </Card>
      ) : results.hits.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<SearchX />}
            title={`Nothing matches “${query}”`}
            description="Try a shorter word. Anything you are not scoped to will not appear here, so it may exist and simply not be yours."
          />
        </Card>
      ) : (
        <div className="mt-4 grid gap-4">
          {[...grouped.entries()].map(([type, hits]) => (
            <Card key={type} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="text-subtle">{ICONS[type]}</span>
                <h2 className="text-sm font-semibold">{LABELS[type]}</h2>
                <Badge tone="grey">{hits.length}</Badge>
              </div>
              <div className="divide-y divide-border">
                {hits.map((hit) => (
                  <Link
                    key={`${hit.type}-${hit.id}`}
                    href={hit.href}
                    className="block px-4 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <p className="truncate text-sm font-medium">{hit.title}</p>
                    <p className="truncate text-xs text-muted">{hit.subtitle}</p>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
