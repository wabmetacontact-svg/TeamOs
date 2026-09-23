import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireManagerPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientFinancials } from "@/lib/ledger";
import { fmtDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, EmptyState, PageHeader, Progress } from "@/components/ui/card";
import { Kpi } from "@/components/app/kpi";
import { AddClientButton, EditClientButton, RecordPaymentDialog } from "@/components/app/client-form";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireManagerPage();
  const clients = await db.client.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
  const withMoney = await Promise.all(clients.map(async (c) => ({ client: c, money: await clientFinancials(c.id) })));

  const totalReceived = withMoney.reduce((s, r) => s + r.money.received, 0);
  const totalPending = withMoney.reduce((s, r) => s + r.money.pending, 0);
  const activeList = clients.filter((c) => c.status === "Active").map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <PageHeader
        title="Clients"
        description="Who pays you, how much has arrived, and what is still outstanding."
        actions={
          <>
            {activeList.length > 0 && <RecordPaymentDialog clients={activeList} today={toDateInput(new Date())} />}
            <AddClientButton />
          </>
        }
      />

      {clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title="No clients yet"
            description="Add a client to track what they owe and what they have paid."
            action={<AddClientButton />}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Clients" value={clients.length} sub={`${activeList.length} active`} />
            <Kpi label="Total received" value={formatMoney(totalReceived)} tone="green" />
            <Kpi label="Outstanding" value={formatMoney(totalPending)} tone={totalPending ? "orange" : "neutral"} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {withMoney.map(({ client, money }) => {
              const contract = client.contractValue ?? 0;
              const progress = contract ? Math.min(Math.round((money.received / contract) * 100), 100) : 0;
              return (
                <Card key={client.id}>
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate font-semibold">{client.name}</h2>
                          <Badge tone={client.status === "Active" ? "green" : "grey"}>{client.status}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted">
                          {[client.company, client.project, client.paymentTerms].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <EditClientButton
                        client={{
                          id: client.id,
                          name: client.name,
                          company: client.company,
                          contactPerson: client.contactPerson,
                          email: client.email,
                          phone: client.phone,
                          project: client.project,
                          contractValue: client.contractValue,
                          paymentTerms: client.paymentTerms,
                          status: client.status,
                          notes: client.notes,
                        }}
                      />
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3.5">
                      <Money label="Contract" value={contract ? formatMoney(contract) : "—"} />
                      <Money label="Received" value={formatMoney(money.received)} className="text-[var(--green)]" />
                      <Money
                        label="Outstanding"
                        value={formatMoney(contract ? Math.max(contract - money.received, 0) : money.pending)}
                        className={contract - money.received > 0 || money.pending > 0 ? "text-[var(--orange)]" : undefined}
                      />
                    </dl>

                    {contract > 0 && (
                      <div className="mt-3">
                        <Progress value={progress} barClassName="bg-[var(--green)]" />
                        <p className="mt-1.5 text-xs text-muted">{progress}% of the contract collected</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        {money.lastPaymentDate
                          ? `Last payment ${formatMoney(money.lastPaymentAmount)} on ${fmtDate(money.lastPaymentDate, "d MMM yyyy")}`
                          : "No payments yet"}
                      </span>
                      {client.status === "Active" && (
                        <RecordPaymentDialog
                          clients={activeList}
                          defaultClientId={client.id}
                          today={toDateInput(new Date())}
                          trigger={
                            <button className="font-medium text-brand hover:underline">Record payment</button>
                          }
                        />
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Money({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-0.5 font-semibold ${className ?? ""}`}>{value}</dd>
    </div>
  );
}
