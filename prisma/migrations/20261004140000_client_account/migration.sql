-- The client's account: login, phone, plan, free notes, and - only if an owner
-- chooses to keep it here - an encrypted password.
--
-- loginId, phone and plan are mirrored from WabMeta for synced clients and
-- typed in for the rest. details belongs to TeamOS alone; the sync never
-- writes it. passwordEnc is AES-256-GCM ciphertext (src/lib/vault.ts); the
-- plain password is never stored, and never sent to the browser with the
-- workspace.
--
-- Columns on a table that already carries tenantId and its row-level security
-- policy. Defaults are empty strings, so existing rows need no backfill.

ALTER TABLE "clients" ADD COLUMN "loginId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "clients" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "clients" ADD COLUMN "plan" TEXT NOT NULL DEFAULT '';
ALTER TABLE "clients" ADD COLUMN "details" TEXT NOT NULL DEFAULT '';
ALTER TABLE "clients" ADD COLUMN "passwordEnc" TEXT;
ALTER TABLE "clients" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
