-- The onboarder's setup sheet, mirrored from WabMeta onto the client.
--
-- One JSON value per client: business type, when setup finished, and its
-- lines. It never holds a password - each line only says whether WabMeta has
-- one. A column on a table that already carries tenantId and its policy.

ALTER TABLE "clients" ADD COLUMN "setup" JSONB;
