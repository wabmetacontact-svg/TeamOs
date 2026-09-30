import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Download } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { brandSubTags, listClients } from "@/lib/clients";
import { brandHex } from "@/lib/brand-colors";
import { can } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { ClientFilters } from "./client-filters";
import { NewClientButton } from "./new-client-button";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const { user, scope } = await requireScope();
  const params = await searchParams;

  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v ? v : undefined;
  };

  const filters = {
    q: one("q"),
    brandId: one("brand"),
    status: one("status"),
    includeArchived: one("archived") === "1",
  };

  const db = tenantDb(user.tenantId);
  const [clients, brands, subTags] = await Promise.all([
    listClients(scope, filters),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true, fieldDefs: true } }),
    brandSubTags(scope),
  ]);

  const query = new URLSearchParams(
    Object.entries({ q: filters.q, brand: filters.brandId, status: filters.status, archived: filters.includeArchived ? "1" : "" })
      .filter(([, v]) => v)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  const filtered = Boolean(filters.q || filters.brandId || filters.status);

  return (
    <>
      <PageHeader
        title="Clients"
        description={
          scope.allClients
            ? "Everyone this workspace does work for, grouped by the brand that owns the relationship."
            : `The ${scope.clientIds.length} ${scope.clientIds.length === 1 ? "client" : "clients"} you are assigned to. Ask an Admin if something is missing.`
        }
        actions={
          <>
            {clients.length > 0 && (
              <Button variant="secondary" asChild>
                <a href={`/api/clients/export${query ? `?${query}` : ""}`}>
                  <Download />
                  Export
                </a>
              </Button>
            )}
            {can(scope, "client:create") && <NewClientButton brands={brands} subTags={subTags} />}
          </>
        }
      />

      <ClientFilters brands={brands} />

      {clients.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Building2 />}
            title={filtered ? "Nothing matches that" : "No clients yet"}
            description={
              filtered
                ? "Try a shorter search, or clear the filters."
                : scope.allClients
                  ? "Add the first one and the rest of the application has something to hang off."
                  : "You have not been assigned to any client yet."
            }
          />
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden">
          <div className="divide-y divide-border">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[11px] font-semibold text-brand"
                  aria-hidden
                >
                  {client.name.slice(0, 2).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm font-medium ${client.status === "Archived" ? "text-muted" : ""}`}>
                      {client.name}
                    </span>
                    {client.subTag && <span className="truncate text-xs text-subtle">· {client.subTag}</span>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    <span
                      className="mr-1 inline-block size-2 rounded-full align-middle"
                      style={{ backgroundColor: brandHex(client.brand.color) }}
                      aria-hidden
                    />
                    {client.brand.name} · {client.billingCurrency}
                    {client._count.contacts > 0 && ` · ${client._count.contacts} contact${client._count.contacts === 1 ? "" : "s"}`}
                    {client._count.transactions > 0 && ` · ${client._count.transactions} entries`}
                  </p>
                </div>

                <Badge tone={statusTone(client.status)}>{client.status}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted">
        {clients.length} shown{filters.includeArchived ? ", archived included" : ""}. Archiving hides a client without
        touching anything attached to it; deleting is refused while anything is.
      </p>
    </>
  );
}

function statusTone(status: string) {
  return status === "Active" ? "green" : status === "Paused" ? "orange" : status === "Archived" ? "grey" : "blue";
}
