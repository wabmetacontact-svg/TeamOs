-- Monthly sales targets, for the whole team (memberId NULL) or one person,
-- with optional per-day figures. Only targets are stored: what was achieved is
-- counted from the clients and money synced from WabMeta.

CREATE TABLE "targets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT,
    "month" DATE NOT NULL,
    "sales" INTEGER,
    "amount" BIGINT,
    "dailySales" INTEGER,
    "dailyAmount" BIGINT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "targets_tenantId_idx" ON "targets"("tenantId");
CREATE INDEX "targets_memberId_idx" ON "targets"("memberId");
-- One target per person per month, and one for the team: NULLS NOT DISTINCT
-- makes the team's NULL memberId collide with itself.
CREATE UNIQUE INDEX "targets_one_per_month" ON "targets"("tenantId", "month", "memberId") NULLS NOT DISTINCT;

ALTER TABLE "targets" ADD CONSTRAINT "targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "targets" ADD CONSTRAINT "targets_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "targets"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teamos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "targets" TO teamos_app;
  END IF;
END
$$;
