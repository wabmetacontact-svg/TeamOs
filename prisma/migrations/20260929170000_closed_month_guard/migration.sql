-- Closing a book month has to mean something.
--
-- The stage 3 gate asks for this specifically: "A write to a closed month is
-- refused by the database trigger, not only by the application." The
-- application will check too, because a friendly message beats a constraint
-- violation — but the application is one import script, one admin console and
-- one forgotten code path away from being bypassed, and a month that was
-- closed, reported on, and then quietly changed is worse than one that was
-- never closed at all.
--
-- What is refused, for a month whose book_months row says Closed:
--   * inserting a transaction into it
--   * updating a transaction that is in it
--   * moving a transaction into it from an open month
--   * soft-deleting one that is in it
--
-- What is still allowed, deliberately:
--   * reopening the month, which is an update to book_months, not to a
--     transaction, and is audited and reason-bearing on its own
--   * a purge, under the same escape hatch the audit log uses, so a tenant can
--     still be offboarded

CREATE OR REPLACE FUNCTION refuse_write_to_closed_month()
RETURNS TRIGGER AS $$
DECLARE
  target_client TEXT;
  target_month  TEXT;
  is_closed     BOOLEAN;
BEGIN
  -- An offboarding purge sets this, exactly as it does for the audit log.
  IF current_setting('app.allow_closed_month_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- On UPDATE, both the old and the new month have to be open: moving a row
  -- out of a closed month changes that month's totals just as much as
  -- changing it in place.
  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM book_months b
      WHERE b."tenantId" = OLD."tenantId"
        AND b."clientId" = OLD."clientId"
        AND b.month = OLD."bookMonth"
        AND b.state = 'Closed'
    ) INTO is_closed;

    IF is_closed THEN
      RAISE EXCEPTION 'book month % is closed for this client', OLD."bookMonth"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  target_client := COALESCE(NEW."clientId", OLD."clientId");
  target_month  := COALESCE(NEW."bookMonth", OLD."bookMonth");

  SELECT EXISTS (
    SELECT 1 FROM book_months b
    WHERE b."tenantId" = COALESCE(NEW."tenantId", OLD."tenantId")
      AND b."clientId" = target_client
      AND b.month = target_month
      AND b.state = 'Closed'
  ) INTO is_closed;

  IF is_closed THEN
    RAISE EXCEPTION 'book month % is closed for this client', target_month
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_closed_month_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_closed_month();

-- Attachments belong to a transaction and therefore to its month. Adding a
-- receipt to a closed month is a smaller change than editing the amount, but
-- it is still a change to a period somebody has signed off.
CREATE OR REPLACE FUNCTION refuse_attachment_to_closed_month()
RETURNS TRIGGER AS $$
DECLARE
  is_closed BOOLEAN;
BEGIN
  IF current_setting('app.allow_closed_month_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM transactions t
    JOIN book_months b
      ON b."tenantId" = t."tenantId"
     AND b."clientId" = t."clientId"
     AND b.month = t."bookMonth"
    WHERE t.id = COALESCE(NEW."transactionId", OLD."transactionId")
      AND b.state = 'Closed'
  ) INTO is_closed;

  IF is_closed THEN
    RAISE EXCEPTION 'that transaction is in a closed book month'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attachments_closed_month_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION refuse_attachment_to_closed_month();

-- A transaction's ref is generated per tenant and has to be unique; the schema
-- already declares that. This index is what makes the per-client-per-month
-- totals the gate reconciles against cheap enough to compute on every page
-- load rather than on a schedule.
CREATE INDEX IF NOT EXISTS "transactions_tenant_client_month_idx"
  ON "transactions" ("tenantId", "clientId", "bookMonth")
  WHERE "deletedAt" IS NULL;

-- Approved rows are read far more often than drafts, and always with the
-- direction beside them.
CREATE INDEX IF NOT EXISTS "transactions_tenant_state_direction_idx"
  ON "transactions" ("tenantId", "approvalState", "direction")
  WHERE "deletedAt" IS NULL;
