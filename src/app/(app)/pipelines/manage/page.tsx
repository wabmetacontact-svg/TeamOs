import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitBranch } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { can } from "@/lib/scope";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { ContextCard } from "./context-card";
import { NewContextButton } from "./new-context-button";

export const metadata: Metadata = { title: "Manage pipelines" };

export default async function ManagePipelinesPage() {
  const { user, scope } = await requireScope();
  if (!can(scope, "settings:view")) notFound();

  const db = tenantDb(user.tenantId);

  // Configuration, so it shows every pipeline rather than the caller's scoped
  // set: you cannot administer a list you are only shown part of. The write
  // side is still gated on settings:edit.
  const contexts = await db.context.findMany({
    include: {
      stages: { orderBy: { position: "asc" } },
      _count: { select: { relationships: { where: { deletedAt: null } } } },
    },
    orderBy: { position: "asc" },
  });

  const counts = await db.relationship.groupBy({
    by: ["stageId"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]));

  const mayEdit = can(scope, "settings:edit");

  return (
    <>
      <Link href="/pipelines" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Back to the board
      </Link>

      <PageHeader
        title="Manage pipelines"
        description="A pipeline is a context — Investor, KOL, Partner — and its stages are the columns. One person holds one relationship per pipeline, so a new pipeline is how the same people get tracked for a different reason."
        actions={mayEdit ? <NewContextButton /> : undefined}
      />

      {contexts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitBranch />}
            title="No pipelines yet"
            description="Add one and it appears on the board immediately."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {contexts.map((context) => (
            <ContextCard
              key={context.id}
              canEdit={mayEdit}
              context={{
                id: context.id,
                name: context.name,
                relationships: context._count.relationships,
                stages: context.stages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  isTerminal: s.isTerminal,
                  count: byStage.get(s.id) ?? 0,
                })),
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
