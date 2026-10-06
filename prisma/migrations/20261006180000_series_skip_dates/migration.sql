-- Days of a recurring task whose occurrence was deleted, so it is not made again.
ALTER TABLE "task_series" ADD COLUMN "skipDates" DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];
