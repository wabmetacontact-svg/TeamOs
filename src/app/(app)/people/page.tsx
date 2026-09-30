import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { listPeople } from "@/lib/relationships";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { DirectoryFilters } from "./directory-filters";

export const metadata: Metadata = { title: "Directory" };

/**
 * Everyone outside the workspace that it deals with — mostly client contacts.
 * Distinct from /team, which is the people who can sign in.
 */
export default async function DirectoryPage({ searchParams }: PageProps<"/people">) {
  const { scope } = await requireScope();
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : undefined;
  const people = await listPeople(scope, { q });

  return (
    <>
      <PageHeader
        title="Directory"
        description="Every person this workspace deals with. One row per human — somebody who is a contact at two clients is entered once."
      />

      <DirectoryFilters />

      {people.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Users />}
            title={q ? "Nobody matches that" : "Nobody here yet"}
            description={
              q ? "Try a shorter search." : "People arrive here when they are added as a contact on a client."
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
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
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
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
