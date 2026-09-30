import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, EyeOff } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { personSummary } from "@/lib/relationships";
import { can, NotFoundError } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Avatar, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { PersonEditor } from "./person-editor";
import { MergePanel } from "./merge-panel";
import { RelationshipPanel } from "./relationship-panel";
import { ActivityPanel } from "./activity-panel";

export async function generateMetadata({ params }: PageProps<"/people/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { scope } = await requireScope();
  try {
    const { person } = await personSummary(scope, id);
    return { title: person.name };
  } catch {
    return { title: "Not found" };
  }
}

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  const { user, scope } = await requireScope();

  let summary;
  try {
    summary = await personSummary(scope, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { person, relationships, hiddenCount, activities } = summary;
  const db = tenantDb(user.tenantId);

  const [contexts, owners] = await Promise.all([
    db.context.findMany({
      where: scope.allContexts ? {} : { id: { in: [...scope.contextIds] } },
      include: { stages: { orderBy: { position: "asc" } } },
      orderBy: { position: "asc" },
    }),
    db.user.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Candidates for a merge. Names close to this one first, because that is what
  // a duplicate looks like — same human, entered twice.
  const mergeCandidates = can(scope, "person:edit")
    ? await db.person.findMany({
        where: { deletedAt: null, id: { not: person.id } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: 100,
      })
    : [];

  // Pipelines this person is not already in, and that this caller can file into.
  const available = contexts.filter((c) => !relationships.some((r) => r.contextId === c.id));

  return (
    <>
      <Link href="/people" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Directory
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={person.name} className="size-9 text-sm" />
            {person.name}
          </span>
        }
        description={[person.email, person.phone].filter(Boolean).join(" · ") || "No contact details yet"}
      />

      {/*
        The awareness banner. It says a relationship exists and refuses to say
        anything else — not the pipeline, not the owner, not the stage. Enough
        to stop a second person cold-approaching them; never enough to learn
        what the first approach is about.
      */}
      {hiddenCount > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-subtle" />
          <div>
            <p className="font-medium">
              {hiddenCount} other {hiddenCount === 1 ? "relationship" : "relationships"} with {person.name.split(" ")[0]}
            </p>
            <p className="mt-0.5 text-muted">
              Somebody here already has a line to them in a pipeline you are not scoped to. Check before reaching out
              cold — ask an Owner if you need the detail.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Relationships"
              description={
                relationships.length === 0
                  ? "None you can see"
                  : `${relationships.length} in ${relationships.length === 1 ? "one pipeline" : "separate pipelines"}, each with its own owner and stage`
              }
            />
            <CardBody>
              <RelationshipPanel
                personId={person.id}
                canEdit={can(scope, "relationship:edit")}
                canCreate={can(scope, "relationship:create")}
                available={available.map((c) => ({ id: c.id, name: c.name, stages: c.stages.map((s) => ({ id: s.id, name: s.name })) }))}
                owners={owners}
                relationships={relationships.map((r) => ({
                  id: r.id,
                  contextId: r.contextId,
                  contextName: r.context.name,
                  stageId: r.stageId,
                  stageName: r.stage?.name ?? null,
                  isTerminal: r.stage?.isTerminal ?? false,
                  ownerName: r.owner?.name ?? null,
                  clientName: r.client?.name ?? null,
                  value: r.value?.toString() ?? null,
                  currency: r.currency,
                  notes: r.notes,
                  stages: contexts.find((c) => c.id === r.contextId)?.stages.map((s) => ({ id: s.id, name: s.name })) ?? [],
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="What has happened"
              description="A note tied to a pipeline is only visible to people scoped to it; an untied one is about the person"
            />
            <CardBody>
              <ActivityPanel
                personId={person.id}
                canEdit={can(scope, "relationship:edit")}
                relationships={relationships.map((r) => ({ id: r.id, label: r.context.name }))}
                activities={activities.map((a) => ({
                  id: a.id,
                  type: a.type,
                  subject: a.subject,
                  body: a.body,
                  occurredAt: a.occurredAt.toISOString(),
                  actor: a.actor.name,
                  context: a.relationship?.context.name ?? null,
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Details" description="One row per human, shared across every pipeline" />
            <CardBody>
              <PersonEditor
                canEdit={can(scope, "person:edit")}
                person={{
                  id: person.id,
                  name: person.name,
                  email: person.email ?? "",
                  phone: person.phone ?? "",
                  notes: person.notes ?? "",
                }}
              />
            </CardBody>
          </Card>

          {can(scope, "person:edit") && mergeCandidates.length > 0 && (
            <Card>
              <CardHeader
                title="Duplicate?"
                description="One row per human is the point — fold a stray one in rather than keeping both"
              />
              <CardBody>
                <MergePanel
                  keepId={person.id}
                  keepName={person.name}
                  hasEmail={Boolean(person.email)}
                  hasPhone={Boolean(person.phone)}
                  candidates={mergeCandidates}
                />
              </CardBody>
            </Card>
          )}

          {person.contacts.length > 0 && (
            <Card>
              <CardHeader title="Contact at" description="Clients where this person is a named contact" />
              <CardBody className="grid gap-2">
                {person.contacts.map((contact) => (
                  <Link
                    key={contact.clientId}
                    href={`/clients/${contact.clientId}`}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <Building2 className="size-4 shrink-0 text-subtle" />
                    <span className="truncate">{contact.client.name}</span>
                    {contact.isPrimary && <Badge tone="blue">Primary</Badge>}
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
