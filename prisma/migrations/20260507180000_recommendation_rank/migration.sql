-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "Recommendation_queryId_createdAt_idx";

-- CreateIndex
CREATE INDEX "Recommendation_queryId_rank_idx" ON "Recommendation"("queryId", "rank");
