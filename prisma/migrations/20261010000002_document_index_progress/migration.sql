-- Progress (0-100) reported while a document is being indexed, and the PDF
-- outline as uploaded so the section tree can be rebuilt in place.
ALTER TABLE "Document" ADD COLUMN "indexProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN "outline" JSONB;
