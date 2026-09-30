-- The audit log is append-only, which is what makes it worth trusting. But an
-- absolute trigger also makes a tenant undeletable: removing a tenant cascades
-- into audit_log, and the cascade is refused.
--
-- So the rule becomes: immutable on every normal path, with one explicit,
-- greppable exception that a purge must declare for itself.
--
--   SET LOCAL app.allow_audit_purge = 'on';
--
-- The application cannot use it: the app role holds no UPDATE or DELETE grant
-- on this table at all. It exists for tenant offboarding, which the
-- architecture keeps in a separate admin path with its own credentials.

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_audit_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
