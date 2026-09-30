import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { auditSummary, searchAudit } from "@/lib/audit";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { AuditFilters } from "./audit-filters";
import { AuditEntry } from "./audit-entry";

export const metadata: Metadata = { title: "Audit" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const { user, scope } = await requireScope();
  if (!can(scope, "audit:view")) notFound();

  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v ? v : undefined;
  };

  const filters = {
    actorId: one("actor"),
    action: one("action"),
    resourceType: one("type"),
    q: one("q"),
    from: one("from"),
    to: one("to"),
  };

  const [entries, summary, people] = await Promise.all([
    searchAudit(scope, filters, 200),
    auditSummary(scope, filters),
    tenantDb(user.tenantId).user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Audit"
        description={
          scope.allClients
            ? "Every change, with who made it and what it was before. Nothing in the application can edit this — the database refuses it."
            : "Changes to the clients you can reach, and your own actions. Workspace-level changes are not shown."
        }
      />

      <AuditFilters people={people} actions={summary.byAction.map((a) => a.action)} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          {entries.length === 0 ? (
            <EmptyState
              icon={<ScrollText />}
              title="Nothing matches"
              description="Try a wider date range, or clear the filters."
            />
          ) : (
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <AuditEntry
                  key={entry.id}
                  entry={{
                    id: entry.id,
                    action: entry.action,
                    actor: entry.actor?.name ?? "System",
                    resourceType: entry.resourceType,
                    resourceId: entry.resourceId,
                    resourceLabel: entry.resourceLabel,
                    before: entry.before,
                    after: entry.after,
                    ip: entry.ip,
                    createdAt: entry.createdAt.toISOString(),
                  }}
                  timeZone={user.timezone}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="What happened" description={`${summary.total} entries match`} />
            <CardBody className="grid gap-2 text-sm">
              {summary.byAction.map((row) => (
                <div key={row.action} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{row.action.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-muted">{row.count}</span>
                </div>
              ))}
              {summary.byAction.length === 0 && <p className="text-muted">Nothing to summarise.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Who" />
            <CardBody className="grid gap-2 text-sm">
              {summary.byActor.map((row) => (
                <div key={row.actorId ?? "system"} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{row.name}</span>
                  <span className="tabular-nums text-muted">{row.count}</span>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="text-xs text-muted">
              <p className="mb-1 font-medium text-fg">Why this can be trusted</p>
              <p>
                The log is append-only at the database: a trigger refuses every update and delete, and the application
                role has no permission to attempt one. Not even a workspace Owner can rewrite an entry.
              </p>
              <p className="mt-1.5">
                <Badge tone="grey">One exception</Badge> — deleting a whole workspace, which has to cascade. It needs a
                setting only the offboarding path sets.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
