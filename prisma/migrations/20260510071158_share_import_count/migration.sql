-- AlterTable
ALTER TABLE "Share" ADD COLUMN "importCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing review imports. Wiki imports never recorded a
-- source token, so they start at 0 — only review history is reconstructible.
UPDATE "Share" SET "importCount" = sub.cnt
FROM (
  SELECT "importedFromShareToken" AS token, COUNT(*)::int AS cnt
  FROM "Review"
  WHERE "importedFromShareToken" IS NOT NULL
  GROUP BY "importedFromShareToken"
) AS sub
WHERE "Share"."token" = sub.token;
