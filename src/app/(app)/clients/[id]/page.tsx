import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { brandSubTags, clientDependencies, clientHistory, getClient } from "@/lib/clients";
import { can, NotFoundError } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ClientEditor } from "./client-editor";
import { ContactsPanel } from "./contacts-panel";
import { TeamPanel } from "./team-panel";
import { HistoryPanel } from "./history-panel";
import { DangerPanel } from "./danger-panel";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { scope } = await requireScope();
  try {
    const client = await getClient(scope, id);
    return { title: client.name };
  } catch {
    return { title: "Not found" };
  }
}

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const { user, scope } = await requireScope();

  // A client outside this person's scope and one that was never created both
  // land here, and both render the same 404. That is the rule from stage 0,
  // and the page is where it has to be visible.
  let client;
  try {
    client = await getClient(scope, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const db = tenantDb(user.tenantId);
  const mayEdit = can(scope, "client:edit");

  const [brands, assignable, history, dependencies, subTags] = await Promise.all([
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, fieldDefs: true } }),
    mayEdit
      ? db.user.findMany({
          where: { status: "Active", allClients: false },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    clientHistory(scope, id, 30),
    clientDependencies(scope, id),
    brandSubTags(scope),
  ]);

  const assigned = new Set(client.scopeGrants.map((g) => g.userId));

  return (
    <>
      <Link href="/clients" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        All clients
      </Link>

      <PageHeader
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{client.brand.name}</Badge>
            {client.subTag && <Badge tone="grey">{client.subTag}</Badge>}
            <Badge tone={client.status === "Active" ? "green" : client.status === "Paused" ? "orange" : client.status === "Archived" ? "grey" : "blue"}>
              {client.status}
            </Badge>
            <span className="text-xs text-muted">
              {client.billingCurrency}
              {client.startDate && ` · since ${client.startDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`}
            </span>
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Details"
              description={mayEdit ? "Every change is recorded below" : "You can read these but not change them"}
            />
            <CardBody>
              <ClientEditor
                canEdit={mayEdit}
                brands={brands}
                subTags={subTags}
                client={{
                  id: client.id,
                  name: client.name,
                  legalName: client.legalName ?? "",
                  brandId: client.brandId,
                  subTag: client.subTag ?? "",
                  status: client.status,
                  billingCurrency: client.billingCurrency,
                  startDate: client.startDate ? client.startDate.toISOString().slice(0, 10) : "",
                  notes: client.notes ?? "",
                  customFields: (client.customFields ?? {}) as Record<string, string | string[]>,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Contacts"
              description="The people at this client. One person can be a contact at several."
            />
            <CardBody>
              <ContactsPanel
                clientId={client.id}
                canEdit={mayEdit}
                contacts={client.contacts.map((c) => ({
                  personId: c.personId,
                  name: c.person.name,
                  email: c.person.email,
                  phone: c.person.phone,
                  title: c.title,
                  isPrimary: c.isPrimary,
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Read from the audit log, which nothing can edit" />
            <CardBody>
              <HistoryPanel
                entries={history.map((h) => ({
                  id: h.id,
                  action: h.action,
                  actor: h.actor?.name ?? "Someone since removed",
                  createdAt: h.createdAt.toISOString(),
                  before: h.before,
                  after: h.after,
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Who can see this" description="Assigning someone here is what grants them access" />
            <CardBody>
              <TeamPanel
                clientId={client.id}
                canEdit={mayEdit}
                assigned={client.scopeGrants.map((g) => ({
                  userId: g.userId,
                  name: g.user.name,
                  email: g.user.email,
                  roleName: g.user.role.name,
                  status: g.user.status,
                }))}
                assignable={assignable.filter((u) => !assigned.has(u.id))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Attached to this client" description="What a deletion would take with it" />
            <CardBody className="grid gap-2 text-sm">
              <Row label="Transactions" value={dependencies.counts.transactions} />
              <Row label="Tasks" value={dependencies.counts.tasks} />
              <Row label="Relationships" value={dependencies.counts.relationships} />
              <Row label="Book months" value={dependencies.counts.bookMonths} />
              <Row label="Recurring spends" value={dependencies.counts.recurringSpends} />
            </CardBody>
          </Card>

          {(can(scope, "client:archive") || can(scope, "client:delete")) && (
            <DangerPanel
              clientId={client.id}
              clientName={client.name}
              status={client.status}
              attachedCount={dependencies.total}
              canArchive={can(scope, "client:archive")}
              canDelete={can(scope, "client:delete")}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={value > 0 ? "font-medium" : "text-subtle"}>{value}</span>
    </div>
  );
}
