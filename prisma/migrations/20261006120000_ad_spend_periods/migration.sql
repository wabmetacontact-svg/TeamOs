-- Ad spend for a day or a week, not only a month. Each entry now says the
-- days it covers; existing entries cover their whole month.

ALTER TABLE "ad_spends" ADD COLUMN "period" TEXT NOT NULL DEFAULT 'month';
ALTER TABLE "ad_spends" ADD COLUMN "fromDate" DATE;
ALTER TABLE "ad_spends" ADD COLUMN "toDate" DATE;

UPDATE "ad_spends"
SET "fromDate" = "month",
    "toDate" = ("month" + INTERVAL '1 month' - INTERVAL '1 day')::date;

ALTER TABLE "ad_spends" ALTER COLUMN "fromDate" SET NOT NULL;
ALTER TABLE "ad_spends" ALTER COLUMN "toDate" SET NOT NULL;
