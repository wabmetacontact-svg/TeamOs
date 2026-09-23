import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManager } from "@/lib/constants";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { AddMemberButton, CategoryManager, MemberRow, PasswordForm, ProfileForm } from "@/components/app/settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const manager = isManager(user.role);

  const [me, members, categories] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, phone: true } }),
    manager
      ? db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] })
      : Promise.resolve([]),
    manager
      ? db.category.findMany({ include: { _count: { select: { transactions: true } } }, orderBy: [{ kind: "asc" }, { name: "asc" }] })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Settings" description="Your profile, and how the workspace is set up." />

      <Card>
        <CardHeader title="My profile" />
        <CardBody>
          <ProfileForm name={me.name} phone={me.phone} email={me.email} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Password" description="Use at least 8 characters." />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>

      {manager && (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              title="Team"
              description="Managers see money and everyone's tasks. Members see only their own tasks."
              action={<AddMemberButton />}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">Member</th>
                    <th className="px-3 py-2.5 font-medium">Designation</th>
                    <th className="px-3 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((m) => (
                    <MemberRow
                      key={m.id}
                      isSelf={m.id === user.id}
                      member={{ id: m.id, name: m.name, email: m.email, role: m.role, active: m.active, designation: m.designation }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Categories & income sources" description="Used by expenses, income and reports." />
            <CardBody>
              <CategoryManager
                categories={categories.map((c) => ({
                  id: c.id,
                  name: c.name,
                  kind: c.kind,
                  color: c.color,
                  archived: c.archived,
                  count: c._count.transactions,
                }))}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
