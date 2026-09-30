"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { formatBookMonth, formatMoney } from "@/lib/money";
import { closeBookMonth, reopenBookMonth } from "../month-actions";

type Month = {
  month: string;
  state: string;
  closedAt: string | null;
  closedBy: string | null;
  reopenReason: string | null;
  unapproved: number;
  income: string;
  spend: string;
};

export function MonthGrid({
  clientId,
  clientName,
  brandName,
  baseCurrency,
  months,
  canClose,
  canReopen,
}: {
  clientId: string;
  clientName: string;
  brandName: string;
  baseCurrency: string;
  months: Month[];
  canClose: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  const closed = months.filter((m) => m.state === "Closed").length;

  return (
    <Card>
      <CardHeader
        title={clientName}
        description={`${brandName} · ${closed} of ${months.length} months closed`}
      />

      <CardBody className="grid gap-3">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-1.5">
          {months.map((month) => {
            const isClosed = month.state === "Closed";
            const empty = month.income === "0" && month.spend === "0" && month.unapproved === 0;
            const open = acting === month.month;

            return (
              <div
                key={month.month}
                className={`rounded-lg border px-3 py-2 ${isClosed ? "border-border bg-surface-2" : empty ? "border-border/60" : "border-border"}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Link
                    href={`/ledger?month=${month.month}&client=${clientId}`}
                    className="min-w-28 text-sm font-medium hover:underline"
                  >
                    {formatBookMonth(month.month)}
                  </Link>

                  <div className="flex flex-1 flex-wrap items-baseline gap-x-3 text-xs tabular-nums">
                    {empty ? (
                      <span className="text-subtle">nothing recorded</span>
                    ) : (
                      <>
                        <span className="text-emerald-600">+{formatMoney(BigInt(month.income), baseCurrency, { compact: true })}</span>
                        <span className="text-[var(--red)]">−{formatMoney(BigInt(month.spend), baseCurrency, { compact: true })}</span>
                      </>
                    )}
                  </div>

                  {month.unapproved > 0 && <Badge tone="orange">{month.unapproved} unapproved</Badge>}

                  {isClosed ? (
                    <Badge tone="grey">
                      <Lock className="size-3" />
                      Closed
                    </Badge>
                  ) : (
                    <Badge tone="green">Open</Badge>
                  )}

                  {isClosed
                    ? canReopen && (
                        <Button size="sm" variant="ghost" onClick={() => { setActing(open ? null : month.month); setError(null); }}>
                          <LockOpen />
                          Reopen
                        </Button>
                      )
                    : canClose &&
                      !empty && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending && open}
                          onClick={() => {
                            setError(null);
                            setForce(false);
                            if (month.unapproved > 0) {
                              setActing(open ? null : month.month);
                              return;
                            }
                            setActing(month.month);
                            start(async () => {
                              const result = await closeBookMonth({ clientId, month: month.month, force: false });
                              if (result.ok) router.refresh();
                              else setError(result.error);
                              setActing(null);
                            });
                          }}
                        >
                          <Lock />
                          Close
                        </Button>
                      )}
                </div>

                {isClosed && (month.closedBy || month.reopenReason) && (
                  <p className="mt-1 text-xs text-subtle">
                    {month.closedBy && `Closed by ${month.closedBy}`}
                    {month.closedAt &&
                      ` on ${new Date(month.closedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                  </p>
                )}

                {!isClosed && month.reopenReason && (
                  <p className="mt-1 text-xs text-subtle">Reopened: {month.reopenReason}</p>
                )}

                {open && isClosed && canReopen && (
                  <form
                    action={(formData) =>
                      start(async () => {
                        setError(null);
                        const result = await reopenBookMonth({
                          clientId,
                          month: month.month,
                          reason: String(formData.get("reason") ?? ""),
                        });
                        if (result.ok) {
                          setActing(null);
                          router.refresh();
                        } else setError(result.error);
                      })
                    }
                    className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2"
                  >
                    <Field
                      label="Why is it reopening?"
                      htmlFor={`reason-${month.month}`}
                      hint="Kept on the record. Anything reported from this month may now change."
                      className="min-w-48 flex-1"
                    >
                      <Input id={`reason-${month.month}`} name="reason" required autoFocus placeholder="Invoice arrived late" />
                    </Field>
                    <Button type="submit" size="sm" variant="primary" loading={pending}>
                      Reopen
                    </Button>
                  </form>
                )}

                {open && !isClosed && month.unapproved > 0 && canClose && (
                  <div className="mt-2 grid gap-2 border-t border-border pt-2">
                    <p className="text-sm text-orange-800">
                      {month.unapproved} {month.unapproved === 1 ? "entry is" : "entries are"} still unapproved. They
                      will not be in the total, and cannot be approved once this is closed.
                    </p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.currentTarget.checked)}
                        className="size-4 accent-brand"
                      />
                      Close anyway — leaving them out is deliberate
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!force}
                        loading={pending}
                        onClick={() =>
                          start(async () => {
                            setError(null);
                            const result = await closeBookMonth({ clientId, month: month.month, force: true });
                            if (result.ok) {
                              setActing(null);
                              router.refresh();
                            } else setError(result.error);
                          })
                        }
                      >
                        Close {formatBookMonth(month.month)}
                      </Button>
                      <Button size="sm" variant="secondary" asChild>
                        <Link href={`/ledger?month=${month.month}&client=${clientId}&state=Submitted`}>Review them first</Link>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
