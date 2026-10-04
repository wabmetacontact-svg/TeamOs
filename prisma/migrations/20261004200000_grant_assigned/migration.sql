-- Edit access for the people WabMeta already assigns to clients.
--
-- Until now the sync gave nobody any client grant, so a seller or onboarder
-- who signed in found an empty Clients screen - Akash Yadav, the seller and
-- onboarder of 13 clients, saw none of them. From now on the sync gives Edit
-- (never Finance) to whoever is newly assigned; this does the same once for
-- the assignments that already exist.
--
-- ON CONFLICT DO NOTHING: an existing grant - Finance included - is left
-- exactly as it is, and running this twice changes nothing. Removed clients
-- are skipped. Only synced clients carry these assignments.

INSERT INTO "client_grants" ("tenantId", "memberId", "clientId", "level")
SELECT c."tenantId", c."ownerMemberId", c."id", 'edit'
FROM "clients" c
WHERE c."ownerMemberId" IS NOT NULL
  AND c."externalSource" IS NOT NULL
  AND c."removedAt" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "client_grants" ("tenantId", "memberId", "clientId", "level")
SELECT c."tenantId", c."onboarderMemberId", c."id", 'edit'
FROM "clients" c
WHERE c."onboarderMemberId" IS NOT NULL
  AND c."externalSource" IS NOT NULL
  AND c."removedAt" IS NULL
ON CONFLICT DO NOTHING;
