import type { Metadata } from "next";
import { MailPlus } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Avatar, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { InviteButton } from "./invite-button";
import { PersonRow } from "./person-row";
import { PendingInviteRow } from "./pending-invite-row";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const { user, scope } = await requireScope();
  const db = tenantDb(user.tenantId);

  const mayInvite = can(scope, "user:invite");

  const mayEditAccess = can(scope, "user:edit");

  const [people, invitations, roles, clients, contexts] = await Promise.all([
    db.user.findMany({
      include: {
        role: { select: { id: true, name: true } },
        scope: { select: { clientId: true } },
        contextScope: { select: { contextId: true } },
        _count: { select: { scope: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    mayInvite
      ? db.invitation.findMany({
          where: { acceptedAt: null },
          include: { role: { select: { name: true } }, invitedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, description: true } }),
    mayEditAccess
      ? db.client.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, brand: { select: { name: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    mayEditAccess
      ? db.context.findMany({ select: { id: true, name: true }, orderBy: { position: "asc" } })
      : Promise.resolve([]),
  ]);

  const active = people.filter((p) => p.status === "Active").length;

  return (
    <>
      <PageHeader
        title="People"
        description={`${active} active ${active === 1 ? "person" : "people"}${
          people.length > active ? `, ${people.length - active} deactivated` : ""
        }. A role decides what someone can do; their client list decides what they can do it to.`}
        actions={mayInvite ? <InviteButton roles={roles} /> : undefined}
      />

      {invitations.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            title="Waiting to be accepted"
            description="Each link works once and expires 72 hours after it was sent"
          />
          <div className="divide-y divide-border">
            {invitations.map((invite) => (
              <PendingInviteRow
                key={invite.id}
                invite={{
                  id: invite.id,
                  email: invite.email,
                  roleName: invite.role.name,
                  invitedByName: invite.invitedBy.name,
                  expiresAt: invite.expiresAt.toISOString(),
                }}
              />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Everyone" description="Deactivating keeps their name on the work they did" />
        {people.length === 0 ? (
          <EmptyState
            icon={<MailPlus />}
            title="No one here yet"
            description="Invite someone and they will set their own password — you never see it."
          />
        ) : (
          <div className="divide-y divide-border">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                isSelf={person.id === user.id}
                canAssignRole={can(scope, "user:assign_role")}
                canDeactivate={can(scope, "user:deactivate")}
                canEditAccess={mayEditAccess}
                roles={roles}
                clients={clients.map((c) => ({ id: c.id, name: c.name, hint: c.brand.name }))}
                contexts={contexts}
                person={{
                  id: person.id,
                  name: person.name,
                  email: person.email,
                  status: person.status,
                  roleId: person.role.id,
                  roleName: person.role.name,
                  allClients: person.allClients,
                  clientCount: person._count.scope,
                  clientIds: person.scope.map((g) => g.clientId),
                  allContexts: person.allContexts,
                  contextIds: person.contextScope.map((g) => g.contextId),
                  lastLoginAt: person.lastLoginAt?.toISOString() ?? null,
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="What each role means" description="Roles are data — an Owner can edit them" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <div key={role.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Avatar name={role.name} className="bg-surface text-fg" />
                <span className="text-sm font-medium">{role.name}</span>
                {role.name === user.roleName && <Badge tone="blue">You</Badge>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{role.description ?? "No description yet."}</p>
            </div>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
