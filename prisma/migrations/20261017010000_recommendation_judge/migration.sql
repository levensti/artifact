-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN "judgeScore" DOUBLE PRECISION;
ALTER TABLE "Recommendation" ADD COLUMN "judgeDetail" JSONB;
