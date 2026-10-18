-- The journal (wiki pages, their sources, backlinks, and revisions) and deep
-- dives were removed. Reviews are now the only thing that can be shared.

-- Journal shares point at wiki pages that are going away.
DELETE FROM "Share" WHERE "kind" = 'wiki' OR "wikiPageId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Share" DROP CONSTRAINT "Share_wikiPageId_fkey";

-- DropIndex
DROP INDEX "Share_wikiPageId_idx";

-- AlterTable
ALTER TABLE "Share" DROP COLUMN "wikiDepth",
DROP COLUMN "wikiPageId";

-- DropTable
DROP TABLE "WikiRevision";

-- DropTable
DROP TABLE "WikiBacklink";

-- DropTable
DROP TABLE "WikiPageSource";

-- DropTable
DROP TABLE "WikiPage";

-- DropTable
DROP TABLE "DeepDive";
