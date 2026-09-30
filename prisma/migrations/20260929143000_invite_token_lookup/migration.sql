-- Accepting an invitation is the one read in this application that happens
-- before a tenant is known, because the token is what identifies the tenant.
-- Under the tenant policy alone, `app.tenant_id` is unset at that moment, so
-- the row the caller is holding a link to is invisible and every invitation
-- link is dead on arrival.
--
-- This adds a second policy. Postgres ORs policies together, so a row on
-- "invitations" is now readable when EITHER the tenant matches OR the caller
-- can name the row's token hash. The second half grants nothing the caller did
-- not already have: they must produce the SHA-256 of a 256-bit token to see the
-- row that token belongs to, and seeing it is the entire point of holding it.
--
-- Deliberately narrow:
--   * FOR SELECT only — claiming the invitation still runs under the tenant
--     policy, after the first read has established which tenant that is.
--   * "invitations" only — the joined tenant, role and inviter are read in a
--     second query bound to the tenant, not through this escape.
--   * current_setting(..., true) is NULL when unset, and `"tokenHash" = NULL`
--     is NULL rather than true, so an unset value matches no rows.
--   * set_config(..., TRUE) in the application makes it transaction-local, so
--     it cannot survive on a pooled connection into somebody else's request.
CREATE POLICY invite_by_token ON "invitations"
  FOR SELECT
  USING ("tokenHash" = current_setting('app.invite_token_hash', true));
