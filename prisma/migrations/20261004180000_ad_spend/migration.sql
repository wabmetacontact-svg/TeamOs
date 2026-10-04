-- Ads run for a person in a month, and the leads they brought.
--
-- The money is also written to ledger_entries as an expense (category "Ads")
-- in the same transaction, so the ledger stays the one place money lives and
-- the month's profit already counts it. This table adds whose leads they were
-- and how many, which the ledger has no place for. Sales and revenue are not
-- stored: they are counted from the clients that person brought in.

CREATE TABLE "ad_spends" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "ledgerEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_spends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ad_spends_tenantId_idx" ON "ad_spends"("tenantId");
CREATE INDEX "ad_spends_memberId_idx" ON "ad_spends"("memberId");

ALTER TABLE "ad_spends" ADD CONSTRAINT "ad_spends_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_spends" ADD CONSTRAINT "ad_spends_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ad_spends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_spends" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ad_spends"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teamos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ad_spends" TO teamos_app;
  END IF;
END
$$;
