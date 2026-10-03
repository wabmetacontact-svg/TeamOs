-- Links rows here to the rows they mirror in WabMeta.
--
-- WabMeta pushes clients, the sales team that brought them in, and the money
-- they paid. Push can deliver the same event twice — a retry after a timeout
-- that in fact succeeded, a redeploy mid-flight — so every mirrored row keeps
-- the id it has over there, and that id is unique per tenant. A second
-- delivery then updates the row it already wrote instead of adding another.
--
-- On ledger_entries this is the constraint that protects the money. The wallet
-- double-credit of 2026-10-02 happened because idempotency was a
-- findFirst-then-create with no unique index behind it, and ten concurrent
-- callers each passed the check: one payment, seven credit rows. A unique
-- index is the version of that check the database enforces.
--
-- NULLs are distinct in a Postgres unique index, so rows created here — which
-- have no externalId — are unaffected, however many of them there are.
--
-- No new table, so tenancy and row-level security are untouched: these columns
-- sit on tables that already carry tenantId and already have their policy.

-- ── members: which WabMeta admin this person is ─────────────────────────────
ALTER TABLE "members" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "members_tenantId_externalId_key" ON "members"("tenantId", "externalId");

-- ── clients: where the client came from, and who brought it in ─────────────
ALTER TABLE "clients" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "clients" ADD COLUMN "externalId" TEXT;
ALTER TABLE "clients" ADD COLUMN "ownerMemberId" TEXT;

CREATE UNIQUE INDEX "clients_tenantId_externalId_key" ON "clients"("tenantId", "externalId");
CREATE INDEX "clients_ownerMemberId_idx" ON "clients"("ownerMemberId");

-- Credit, not access. If the member who brought a client in leaves and is
-- deleted, the client stays and simply has no owner — the same shape as
-- members_managerId_fkey.
ALTER TABLE "clients" ADD CONSTRAINT "clients_ownerMemberId_fkey"
  FOREIGN KEY ("ownerMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── ledger_entries: the same rupee is never written twice ──────────────────
ALTER TABLE "ledger_entries" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "ledger_entries_tenantId_externalId_key" ON "ledger_entries"("tenantId", "externalId");
