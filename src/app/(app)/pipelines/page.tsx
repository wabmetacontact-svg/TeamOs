import type { Metadata } from "next";
import Link from "next/link";
import { GitBranch, Settings2 } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { listContexts, listRelationships, pipelineSummary } from "@/lib/relationships";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { NewRelationshipButton } from "./new-relationship-button";
import { PipelineBoard } from "./pipeline-board";

export const metadata: Metadata = { title: "Pipelines" };

export default async function PipelinesPage({ searchParams }: PageProps<"/pipelines">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;
  const requested = typeof params.context === "string" ? params.context : undefined;

  const contexts = await listContexts(scope);

  if (contexts.length === 0) {
    return (
      <>
        <PageHeader title="Pipelines" description="Investor, KOL, partner — each one its own board." />
        <Card>
          <EmptyState
            icon={<GitBranch />}
            title="No pipelines you can see"
            description="Either none have been set up, or your role is not scoped to any. An Owner can change that."
          />
        </Card>
      </>
    );
  }

  // A requested pipeline outside scope falls back to the first in scope rather
  // than erroring — listContexts already decided what is reachable.
  const active = contexts.find((c) => c.id === requested) ?? contexts[0]!;

  const db = tenantDb(user.tenantId);
  const [summary, relationships, owners, clients] = await Promise.all([
    pipelineSummary(scope, active.id),
    listRelationships(scope, { contextId: active.id, includeTerminal: true }),
    db.user.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const live = relationships.filter((r) => !r.stage?.isTerminal).length;

  return (
    <>
      <PageHeader
        title="Pipelines"
        description={`${live} live in ${active.name}${relationships.length > live ? `, ${relationships.length - live} closed` : ""}. One person holds one relationship per pipeline, and can hold several across them.`}
        actions={
          <>
            {can(scope, "settings:view") && (
              <Button variant="secondary" asChild>
                <Link href="/pipelines/manage">
                  <Settings2 />
                  Manage
                </Link>
              </Button>
            )}
            {can(scope, "relationship:create") && (
            <NewRelationshipButton
              contexts={contexts.map((c) => ({ id: c.id, name: c.name, stages: c.stages }))}
              defaultContextId={active.id}
              owners={owners}
                clients={clients}
              />
            )}
          </>
        }
      />

      {contexts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {contexts.map((context) => (
            <Link
              key={context.id}
              href={`/pipelines?context=${context.id}`}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 ring-inset transition-colors ${
                context.id === active.id
                  ? "bg-brand-soft text-brand ring-brand/30"
                  : "bg-surface text-muted ring-border hover:text-fg"
              }`}
            >
              {context.name}
              <span className="ml-1.5 opacity-60">{context._count.relationships}</span>
            </Link>
          ))}
        </div>
      )}

      {summary.stages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitBranch />}
            title={`${active.name} has no stages`}
            description="A pipeline without stages is a list. Add stages and it becomes a board."
          />
        </Card>
      ) : (
        <PipelineBoard
          canEdit={can(scope, "relationship:edit")}
          stages={summary.stages.map((s) => ({
            id: s.id,
            name: s.name,
            isTerminal: s.isTerminal,
            count: s.count,
            value: s.value.toString(),
          }))}
          cards={relationships.map((r) => ({
            id: r.id,
            personId: r.person.id,
            personName: r.person.name,
            personEmail: r.person.email,
            stageId: r.stageId,
            ownerName: r.owner?.name ?? null,
            clientName: r.client?.name ?? null,
            value: r.value?.toString() ?? null,
            currency: r.currency,
            activities: r._count.activities,
          }))}
        />
      )}

      {summary.unstaged > 0 && (
        <p className="mt-3 text-xs text-muted">
          <Badge tone="orange">{summary.unstaged}</Badge> not on any stage yet — open one to place it.
        </p>
      )}
    </>
  );
}
