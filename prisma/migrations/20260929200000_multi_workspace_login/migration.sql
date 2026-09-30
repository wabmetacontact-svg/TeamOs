-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pending_signups" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_signups_email_key" ON "pending_signups"("email");
CREATE UNIQUE INDEX "pending_signups_tokenHash_key" ON "pending_signups"("tokenHash");
CREATE INDEX "pending_signups_expiresAt_idx" ON "pending_signups"("expiresAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- pending_signups is the one table in this database that is not tenant-owned,
-- because the whole point of it is to exist before a tenant does. It therefore
-- has no tenant policy and cannot have one.
--
-- What protects it instead: the token hash is the only way to reach a row, the
-- rows are short-lived, and the only write path is the signup action. The
-- structural test in tests/schema.test.ts knows about this exemption by name,
-- so it stays deliberate rather than becoming a table somebody forgot.
--
-- RLS is still enabled with a deny-all default, so a stray query that reaches
-- this table without going through the signup path gets nothing. The signup
-- path uses lookups by unique key, which the policy below permits.
ALTER TABLE "pending_signups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_signups" FORCE ROW LEVEL SECURITY;

-- Readable and writable only while the signup flow says so. The setting is
-- transaction-local, so it cannot survive onto a pooled connection.
CREATE POLICY signup_flow ON "pending_signups"
  USING (current_setting('app.signup_flow', true) = 'on')
  WITH CHECK (current_setting('app.signup_flow', true) = 'on');

-- ─────────────────────────────────────────────────────────────────────────────
-- One email can belong to more than one workspace — the unique index on users
-- is (tenantId, email), not email alone, which is what makes a person able to
-- work for two agencies at once.
--
-- The single-tenant resolver written for the login fix therefore returns an
-- arbitrary one of them, which is a bug that only appears once a second
-- workspace exists. This replaces it with a function that returns them all,
-- and the login form asks which when there is more than one.
DROP FUNCTION IF EXISTS auth_tenant_for_email(TEXT);

CREATE OR REPLACE FUNCTION auth_tenants_for_email(login_email TEXT)
RETURNS TABLE (tenant_id TEXT, tenant_name TEXT, tenant_slug TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.slug
  FROM users u
  JOIN tenants t ON t.id = u."tenantId"
  WHERE lower(u.email) = lower(login_email)
    AND t.status = 'Active'
    AND u.status = 'Active'
  ORDER BY t.name;
$$;

REVOKE ALL ON FUNCTION auth_tenants_for_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_tenants_for_email(TEXT) TO teamos_app;

COMMENT ON FUNCTION auth_tenants_for_email(TEXT) IS
  'Every active workspace an email can sign in to. Returns ids and display names only; the user row is read under the ordinary tenant policy afterwards.';
