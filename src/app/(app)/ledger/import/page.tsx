import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { can, clientIdScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui/card";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const { user, scope } = await requireScope();
  if (!can(scope, "expense:create")) notFound();

  const clients = await tenantDb(user.tenantId).client.findMany({
    where: { ...clientIdScope(scope), deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <Link href="/ledger" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Ledger
      </Link>

      <PageHeader
        title="Import a sheet"
        description="Nothing is written until you have seen every row and the totals at the bottom. A file with one bad row imports nothing until you decide to skip it — a half-imported month is worse than a failed import, because the failure is visible and the half is not."
      />

      <ImportWizard clients={clients} baseCurrency={user.baseCurrency} canApprove={can(scope, "expense:approve")} />
    </>
  );
}
