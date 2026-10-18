-- Every research brief now lives in a project. Move each user's unfiled
-- briefs into one "Earlier research" project (follow-up threading is kept
-- client-side, so one project per user keeps threads together), then make
-- deleting a project delete its briefs.

-- File existing unfiled briefs.
CREATE TEMP TABLE "_unfiled_owner" AS
SELECT DISTINCT "userId", gen_random_uuid()::text AS "projectId"
FROM "DiscoverQuery"
WHERE "projectId" IS NULL;

INSERT INTO "Project" ("id", "userId", "name", "createdAt")
SELECT "projectId", "userId", 'Earlier research', CURRENT_TIMESTAMP
FROM "_unfiled_owner";

UPDATE "DiscoverQuery" q
SET "projectId" = o."projectId"
FROM "_unfiled_owner" o
WHERE q."projectId" IS NULL AND q."userId" = o."userId";

DROP TABLE "_unfiled_owner";

-- DropForeignKey
ALTER TABLE "DiscoverQuery" DROP CONSTRAINT "DiscoverQuery_projectId_fkey";

-- AddForeignKey
ALTER TABLE "DiscoverQuery" ADD CONSTRAINT "DiscoverQuery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
