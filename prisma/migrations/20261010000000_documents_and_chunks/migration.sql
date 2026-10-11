-- Content-addressed documents + semantic chunks with pgvector embeddings.
-- Additive: the legacy per-user ParsedPaper / PageMap tables are left in place
-- (and folded into Document below) so this step is reversible. They are
-- dropped by the following migration once the backfill is verified.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "DocumentIndexStatus" AS ENUM ('pending', 'indexing', 'ready', 'failed');

CREATE TABLE "Document" (
  "id"             TEXT NOT NULL,
  "hash"           TEXT NOT NULL,
  "text"           TEXT,
  "charCount"      INTEGER NOT NULL DEFAULT 0,
  "title"          TEXT,
  "parsed"         JSONB,
  "pageMap"        JSONB,
  "indexStatus"    "DocumentIndexStatus" NOT NULL DEFAULT 'pending',
  "indexError"     TEXT,
  "embeddingModel" TEXT,
  "embeddingDims"  INTEGER,
  "chunkCount"     INTEGER NOT NULL DEFAULT 0,
  "indexStartedAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Document_hash_key" ON "Document"("hash");

CREATE TABLE "DocumentSection" (
  "id"         TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "parentId"   TEXT,
  "ordinal"    INTEGER NOT NULL,
  "depth"      INTEGER NOT NULL,
  "label"      TEXT,
  "title"      TEXT NOT NULL,
  "startPage"  INTEGER,
  "endPage"    INTEGER,
  "charStart"  INTEGER NOT NULL,
  "charEnd"    INTEGER NOT NULL,
  CONSTRAINT "DocumentSection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentSection_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DocumentSection_parentId_fkey" FOREIGN KEY ("parentId")
    REFERENCES "DocumentSection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "DocumentSection_documentId_ordinal_idx" ON "DocumentSection"("documentId", "ordinal");

-- Embeddings are stored as half-precision vectors: qwen3-embedding-8b is
-- truncated (Matryoshka) to 2048 dims, which is past pgvector's 2000-dim
-- cap for an index on `vector` but inside the 4000-dim cap for `halfvec`.
-- No ANN index yet: every query is scoped to one document (a few hundred
-- rows), where an exact scan is both faster to build and more accurate. Add
-- an HNSW index (`USING hnsw ("embedding" halfvec_cosine_ops)`) when
-- cross-document search lands.
CREATE TABLE "DocumentChunk" (
  "id"         TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "sectionId"  TEXT,
  "ordinal"    INTEGER NOT NULL,
  "text"       TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "startPage"  INTEGER,
  "endPage"    INTEGER,
  "charStart"  INTEGER NOT NULL,
  "charEnd"    INTEGER NOT NULL,
  "embedding"  halfvec(2048),
  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DocumentChunk_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "DocumentSection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DocumentChunk_documentId_ordinal_key" ON "DocumentChunk"("documentId", "ordinal");

-- Review → Document edge. Backfilled lazily by the client (the hash is
-- computed from the extracted text, which only the browser has), so it
-- starts null everywhere.
ALTER TABLE "Review" ADD COLUMN "documentId" TEXT;
ALTER TABLE "Review" ADD CONSTRAINT "Review_documentId_fkey" FOREIGN KEY ("documentId")
  REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Review_documentId_idx" ON "Review"("documentId");

-- Backfill: fold the per-user caches into one row per hash. The parse is a
-- deterministic function of the text, so duplicates across users carry the
-- same information; keep the most recently written one (ctid order is the
-- best proxy available — the legacy tables have no timestamp).
INSERT INTO "Document" ("id", "hash", "parsed", "title", "updatedAt")
SELECT DISTINCT ON (p."hash")
  gen_random_uuid()::text,
  p."hash",
  p."parsed",
  NULLIF(p."parsed"->>'title', ''),
  CURRENT_TIMESTAMP
FROM "ParsedPaper" p
ORDER BY p."hash", p.ctid DESC;

INSERT INTO "Document" ("id", "hash", "pageMap", "title", "updatedAt")
SELECT DISTINCT ON (m."hash")
  gen_random_uuid()::text,
  m."hash",
  m."map",
  NULLIF(m."map"->>'title', ''),
  CURRENT_TIMESTAMP
FROM "PageMap" m
ORDER BY m."hash", m.ctid DESC
ON CONFLICT ("hash") DO UPDATE
  SET "pageMap" = EXCLUDED."pageMap",
      "title"   = COALESCE("Document"."title", EXCLUDED."title");
