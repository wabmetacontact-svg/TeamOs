-- Signing in has the same ordering problem invitations had: row-level security
-- needs a tenant, and at the moment somebody types their email nothing has
-- identified one yet. The `users` row is therefore invisible to the application
-- role, findFirst({ email }) returns null, and every login is refused as
-- "wrong email or password".
--
-- A SECURITY DEFINER function returns the tenant id for an email and nothing
-- else. The application then binds to that tenant and reads the user under the
-- ordinary policy.
--
-- Superseded by 20260929200000_multi_workspace_login, which replaces this with
-- a version returning every workspace an address can reach — one email can
-- belong to two, and this one returns an arbitrary one of them. Kept because it
-- has already been applied; migrations go forward, not away.

CREATE OR REPLACE FUNCTION auth_tenant_for_email(login_email TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u."tenantId"
  FROM users u
  JOIN tenants t ON t.id = u."tenantId"
  WHERE lower(u.email) = lower(login_email)
    AND t.status = 'Active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_tenant_for_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_tenant_for_email(TEXT) TO teamos_app;
