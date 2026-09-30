import type { Metadata } from "next";
import Link from "next/link";
import { EyeOff, Users } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { listContexts, listPeople } from "@/lib/relationships";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { DirectoryFilters } from "./directory-filters";

export const metadata: Metadata = { title: "Directory" };

/**
 * Everyone outside the workspace: investors, KOLs, client contacts. Distinct
 * from /team, which is the people who can sign in.
 */
export default async function DirectoryPage({ searchParams }: PageProps<"/people">) {
  const { scope } = await requireScope();
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : undefined;
  const contextId = typeof params.context === "string" ? params.context : undefined;

  const [people, contexts] = await Promise.all([listPeople(scope, { q, contextId }), listContexts(scope)]);
  const hiddenTotal = people.reduce((sum, p) => sum + p.hiddenCount, 0);

  return (
    <>
      <PageHeader
        title="Directory"
        description="Every person this workspace knows, and what they are to it. One row per human — the same person can appear in several pipelines without being entered twice."
      />

      <DirectoryFilters contexts={contexts.map((c) => ({ id: c.id, name: c.name }))} />

      {people.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Users />}
            title={q || contextId ? "Nobody matches that" : "Nobody here yet"}
            description={
              q || contextId
                ? "Try a shorter search, or clear the filter."
                : "People arrive by being added to a pipeline or as a client contact."
            }
          />
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden">
          <div className="divide-y divide-border">
            {people.map((person) => (
              <Link
                key={person.id}
                href={`/people/${person.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <Avatar name={person.name} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="truncate text-xs text-muted">
                    {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact details"}
                    {person._count.contacts > 0 &&
                      ` · contact at ${person._count.contacts} ${person._count.contacts === 1 ? "client" : "clients"}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {person.relationships.map((rel) => (
                    <Badge key={rel.id} tone="blue">
                      {rel.context.name}
                      {rel.stage && <span className="opacity-60">· {rel.stage.name}</span>}
                    </Badge>
                  ))}

                  {/* The banner, in its smallest form. A number and nothing
                      else — see lib/relationships.ts for why. */}
                  {person.hiddenCount > 0 && (
                    <Badge tone="grey">
                      <EyeOff className="size-3" />
                      {person.hiddenCount} more
                    </Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {hiddenTotal > 0 && can(scope, "relationship:view") && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" />
          {hiddenTotal} {hiddenTotal === 1 ? "relationship is" : "relationships are"} in pipelines you are not scoped
          to. You are told they exist so nobody approaches the same person twice; ask an Owner if you need one of them.
        </p>
      )}
    </>
  );
}
