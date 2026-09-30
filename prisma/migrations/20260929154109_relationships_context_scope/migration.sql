-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allContexts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "user_context_scope" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_context_scope_pkey" PRIMARY KEY ("userId","contextId")
);

-- CreateIndex
CREATE INDEX "user_context_scope_tenantId_idx" ON "user_context_scope"("tenantId");

-- AddForeignKey
ALTER TABLE "user_context_scope" ADD CONSTRAINT "user_context_scope_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_context_scope" ADD CONSTRAINT "user_context_scope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_context_scope" ADD CONSTRAINT "user_context_scope_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Everything below is what Prisma's schema language cannot express, and each
-- piece is load-bearing.

-- A new tenant-owned table is not isolated until it says so. The structural
-- test in tests/schema.test.ts fails if this is ever forgotten on a new table,
-- which is the only reason it will not be.
ALTER TABLE "user_context_scope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_context_scope" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_context_scope"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Person dedupe: one row per email per tenant, case-insensitively.
--
-- The rule the PRD asks for is `(tenant_id, lower(email))`, which Prisma cannot
-- declare because the index is on an expression. It is also partial: email is
-- optional, and NULLs do not conflict with each other in Postgres anyway, but
-- writing WHERE makes that a decision rather than an accident. Soft-deleted
-- rows are excluded so a deleted person's address can be used again.
--
-- This is a constraint rather than a check in the application because the
-- application checks it in one place and Postgres checks it in all of them,
-- including a concurrent insert that the application's own lookup would miss.
CREATE UNIQUE INDEX "people_tenant_email_unique"
  ON "people" ("tenantId", lower("email"))
  WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;
