import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { readFieldDefs } from "@/lib/custom-fields";
import { can } from "@/lib/scope";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { BrandCard } from "./brand-card";
import { NewBrandButton } from "./new-brand-button";

export const metadata: Metadata = { title: "Brands" };

/**
 * Brands are workspace configuration, not client data, so they sit behind
 * settings permissions rather than client ones. A Manager who runs two clients
 * has no business changing what every client form asks for.
 */
export default async function BrandsPage() {
  const { user, scope } = await requireScope();
  if (!can(scope, "settings:view")) notFound();

  const db = tenantDb(user.tenantId);
  const brands = await db.brand.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { clients: true, categories: true, tasks: true } } },
  });

  const mayEdit = can(scope, "settings:edit");

  return (
    <>
      <PageHeader
        title="Brands"
        description="A brand owns its clients and decides what their form asks for. Every brand runs differently enough that one fixed form would be wrong for all of them."
        actions={mayEdit ? <NewBrandButton /> : undefined}
      />

      {brands.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers />}
            title="No brands yet"
            description="A client has to belong to one, so this is the first thing to set up."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {brands.map((brand) => (
            <BrandCard
              key={brand.id}
              canEdit={mayEdit}
              brand={{
                id: brand.id,
                name: brand.name,
                color: brand.color,
                fieldDefs: readFieldDefs(brand.fieldDefs),
                clients: brand._count.clients,
                categories: brand._count.categories,
                tasks: brand._count.tasks,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
