-- Per-person feature access, on top of the role.
--
-- A role is still the default: most people are exactly "a Member" and nothing
-- else. These columns hold only the difference — what this one person was
-- given beyond their role, and what was taken away from it — so a later edit
-- to the role still reaches them for everything nobody changed by hand.
--
-- Stored as keys rather than rows in a join table because they are read on
-- every request, beside the role, and never queried on their own.
ALTER TABLE "users" ADD COLUMN "permissionsGranted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "permissionsRevoked" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- An invitation carries the same difference until it is accepted.
ALTER TABLE "invitations" ADD COLUMN "permissionsGranted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "invitations" ADD COLUMN "permissionsRevoked" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
