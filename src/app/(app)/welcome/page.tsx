import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Receipt, ShieldAlert, SquareCheck, Users } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { twoFactorRequiredFor } from "@/lib/totp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Welcome" };

/**
 * The first screen in a brand-new workspace.
 *
 * It exists because an empty application is hard to tell apart from a broken
 * one: every list says "nothing here", and nothing says which of them to fill
 * first. This is the order that actually works — a brand, then a client, then
 * everything else hangs off that.
 */
export default async function WelcomePage() {
  const { user, scope } = await requireScope();
  const db = tenantDb(user.tenantId);

  const [brands, clients, tasks, entries, roles] = await Promise.all([
    db.brand.count(),
    db.client.count({ where: { deletedAt: null } }),
    db.task.count({ where: { deletedAt: null } }),
    db.transaction.count({ where: { deletedAt: null } }),
    db.role.count(),
  ]);

  const needsTwoFactor = twoFactorRequiredFor(scope.roleName);

  const steps = [
    {
      done: brands > 0,
      href: "/brands",
      icon: <Building2 className="size-4" />,
      title: "Add a brand",
      body: "A client belongs to one, and a brand decides what its client form asks for. Start with a single one — more can follow.",
    },
    {
      done: clients > 0,
      href: "/clients",
      icon: <Building2 className="size-4" />,
      title: "Add your first client",
      body: "Everything else hangs off a client: the money, the tasks, the relationships.",
    },
    {
      done: entries > 0,
      href: "/ledger/import",
      icon: <Receipt className="size-4" />,
      title: "Bring your ledger in",
      body: "Import a CSV of a month you already keep, and check the totals match before anything is written.",
    },
    {
      done: tasks > 0,
      href: "/tasks",
      icon: <SquareCheck className="size-4" />,
      title: "Put the first task on somebody",
      body: "With an estimate, which is compared against the real time when it is done.",
    },
    {
      done: false,
      href: "/team",
      icon: <Users className="size-4" />,
      title: "Invite your team",
      body: "They set their own password — you never handle it. Their role decides what they can do; their scope decides what they can do it to.",
    },
  ];

  return (
    <>
      <PageHeader
        title={`${user.tenantName} is ready`}
        description={`You are the Owner. ${roles} roles are set up, along with a chart of accounts you can edit. Here is the order that works.`}
      />

      {needsTwoFactor && (
        <Link
          href="/security"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 transition-colors hover:bg-orange-100"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Set up two-step verification first</p>
            <p className="mt-0.5 text-orange-700">
              Required for an Owner, and nothing else opens until it is done. It takes about a minute.
            </p>
          </div>
          <ArrowRight className="ml-auto mt-0.5 size-4 shrink-0" />
        </Link>
      )}

      <div className="grid gap-3">
        {steps.map((step, i) => (
          <Card key={step.title} className={step.done ? "opacity-60" : undefined}>
            <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                  step.done ? "bg-emerald-50 text-emerald-600" : "bg-brand-soft text-brand"
                }`}
              >
                {step.done ? "✓" : step.icon}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{step.title}</p>
                  {step.done && <Badge tone="green">Done</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">{step.body}</p>
              </div>

              <Button variant={step.done ? "ghost" : "secondary"} size="sm" asChild>
                <Link href={step.href}>
                  {step.done ? "Open" : `Step ${i + 1}`}
                  <ArrowRight />
                </Link>
              </Button>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader title="What is already here" description="Seeded so the workspace is usable on the first day" />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Roles" value={`${roles} — Owner, Admin, Finance, Manager, Member`} />
          <Row label="Categories" value="A two-level chart of accounts, in and out" />
          <Row label="Base currency" value={`${user.baseCurrency} · ${user.timezone}`} />
        </CardBody>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
