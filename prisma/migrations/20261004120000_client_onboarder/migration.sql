-- Who is onboarding a client, kept apart from who brought it in.
--
-- In WabMeta a sales person sells a client and hands it to an onboarder. The
-- sale stays with the seller (ownerMemberId, which the Sales tab credits); the
-- onboarder is the person doing the work now. One column could not hold both
-- without the handover erasing the sale.
--
-- A column on a table that already has tenantId and its row-level security
-- policy, so tenancy is untouched.

ALTER TABLE "clients" ADD COLUMN "onboarderMemberId" TEXT;

CREATE INDEX "clients_onboarderMemberId_idx" ON "clients"("onboarderMemberId");

-- Same shape as clients_ownerMemberId_fkey: somebody leaving the team leaves
-- the client in place with nobody onboarding it.
ALTER TABLE "clients" ADD CONSTRAINT "clients_onboarderMemberId_fkey"
  FOREIGN KEY ("onboarderMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
