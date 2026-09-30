-- Per-user notification preferences.
--
-- A JSON column rather than a table of (user, event, channel) rows, because
-- the thing being stored is a sparse set of overrides — "email me nothing
-- except approvals" — and a row per combination would be mostly rows saying
-- "the default". The defaults live in code, where they can change without a
-- migration and without every existing user needing a backfill.
ALTER TABLE "users" ADD COLUMN "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

-- Delivery walks the queue oldest-first, filtered by status. Without this it
-- is a sequential scan of every notification ever sent.
CREATE INDEX IF NOT EXISTS "notifications_status_created_idx"
  ON "notifications" ("status", "createdAt")
  WHERE "status" IN ('queued', 'failed');

-- The audit search filters by actor and by resource, and orders by time. The
-- schema already indexes (tenantId, createdAt) and (resourceType, resourceId);
-- this is the third axis the search UI offers.
CREATE INDEX IF NOT EXISTS "audit_log_tenant_actor_created_idx"
  ON "audit_log" ("tenantId", "actorId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "audit_log_tenant_action_created_idx"
  ON "audit_log" ("tenantId", "action", "createdAt" DESC);
