-- The structured LLM parse is gone: long documents are served by retrieval
-- over the chunk index, and section chips resolve from DocumentSection.
ALTER TABLE "Document" DROP COLUMN "parsed";
