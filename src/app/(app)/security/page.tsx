import type { Metadata } from "next";
import { Laptop, ShieldAlert, ShieldCheck } from "lucide-react";
import { requireScope } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { twoFactorRequiredFor } from "@/lib/totp";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { TwoFactorPanel } from "./two-factor-panel";
import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const { user, scope } = await requireScope();
  const db = tenantDb(user.tenantId);

  const [me, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { twoFactorEnabled: true, twoFactorAddedAt: true, twoFactorRecovery: true },
    }),
    db.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userAgent: true, ip: true, createdAt: true },
    }),
  ]);

  const required = twoFactorRequiredFor(scope.roleName);

  return (
    <>
      <PageHeader
        title="Security"
        description="Your own account. Nobody else's settings are here, including an Owner's."
      />

      {required && !me.twoFactorEnabled && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Two-step verification is required for {scope.roleName}s</p>
            <p className="mt-0.5 text-orange-700">
              Your role can change what everyone else is allowed to do, so a password on its own is not enough. Set it
              up below — it takes about a minute.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Two-step verification"
            description="A code from your phone, on top of your password"
            action={
              me.twoFactorEnabled ? (
                <Badge tone="green">
                  <ShieldCheck className="size-3" /> On
                </Badge>
              ) : (
                <Badge tone={required ? "orange" : "grey"}>{required ? "Required" : "Off"}</Badge>
              )
            }
          />
          <CardBody>
            <TwoFactorPanel
              enabled={me.twoFactorEnabled}
              required={required}
              roleName={scope.roleName}
              addedAt={me.twoFactorAddedAt?.toISOString() ?? null}
              recoveryRemaining={me.twoFactorRecovery.length}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where you are signed in"
            description="Ending a session takes effect on that device's next click"
            action={
              <Badge tone="blue">
                <Laptop className="size-3" /> {sessions.length}
              </Badge>
            }
          />
          <CardBody>
            <SessionsPanel
              currentSessionId={user.sessionId}
              sessions={sessions.map((s) => ({
                id: s.id,
                userAgent: s.userAgent,
                ip: s.ip,
                createdAt: s.createdAt.toISOString(),
              }))}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
