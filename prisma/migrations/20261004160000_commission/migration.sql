-- Commission: a rate per member with its history, and commissions given by hand.
--
-- The automatic part is a member's rate times the money their own clients
-- paid in a month. commission_rates keeps every rate with the date it began,
-- the way salary_changes does, so money received under an old rate is still
-- worked out at that rate. commission_rules are everything else - a fixed
-- amount per onboarding, a bonus, a share of one client for somebody who did
-- not bring it in - and are added on top.
--
-- Paying a commission writes an expense to ledger_entries (category
-- "Commissions"), like a salary, so the month's profit already accounts for it.
-- Nothing here stores money that is also stored somewhere else.
--
-- Both tables carry tenantId with a foreign key and the tenant isolation
-- policy, forced, like every other table (tests/schema.test.ts checks it).

ALTER TABLE "tenants" ADD COLUMN "commissionSkip" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "commission_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "bps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "repeat" TEXT NOT NULL DEFAULT 'once',
    "fromMonth" DATE NOT NULL,
    "toMonth" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_rates_tenantId_idx" ON "commission_rates"("tenantId");
CREATE INDEX "commission_rates_memberId_idx" ON "commission_rates"("memberId");
CREATE INDEX "commission_rules_tenantId_idx" ON "commission_rules"("tenantId");
CREATE INDEX "commission_rules_memberId_idx" ON "commission_rules"("memberId");

ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commission_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commission_rates"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "commission_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commission_rules"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- The application role reaches new tables through default privileges set by
-- scripts/create-app-role.ts. Granting here too means a database where that
-- default was never set still works, instead of failing on first use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teamos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "commission_rates", "commission_rules" TO teamos_app;
  END IF;
END
$$;
