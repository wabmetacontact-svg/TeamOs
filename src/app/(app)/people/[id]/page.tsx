import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { personSummary } from "@/lib/relationships";
import { can, NotFoundError } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Avatar, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { PersonEditor } from "./person-editor";
import { MergePanel } from "./merge-panel";
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

  // Pipelines were removed from the product; the relationships already in the
  // database stay where they are, and notes tied to a pipeline this person
  // cannot see stay hidden by personSummary exactly as before.
  const { person, activities } = summary;
  const db = tenantDb(user.tenantId);

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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="What has happened"
              description="Calls, meetings, messages and notes about this person"
            />
            <CardBody>
              <ActivityPanel
                personId={person.id}
                canEdit={can(scope, "person:edit")}
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
            <CardHeader title="Details" description="One row per human, however many clients they are a contact at" />
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
