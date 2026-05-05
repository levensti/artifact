-- Convert WikiRevision.id from SERIAL int to TEXT (uuid). Table is empty,
-- so the column is dropped and recreated rather than backfilled.

DROP INDEX "WikiRevision_pageId_id_idx";

ALTER TABLE "WikiRevision" DROP CONSTRAINT "WikiRevision_pkey";
ALTER TABLE "WikiRevision" DROP COLUMN "id";
ALTER TABLE "WikiRevision" ADD COLUMN "id" TEXT NOT NULL;
ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_pkey" PRIMARY KEY ("id");

DROP SEQUENCE IF EXISTS "WikiRevision_id_seq";

CREATE INDEX "WikiRevision_pageId_id_idx" ON "WikiRevision"("pageId", "id");
