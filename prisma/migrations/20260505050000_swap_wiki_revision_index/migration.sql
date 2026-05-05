-- Replace the (pageId, id) index with (pageId, savedAt) since UUID ids are
-- not time-sortable; "most recent revisions for page" now sorts on savedAt.

DROP INDEX "WikiRevision_pageId_id_idx";
CREATE INDEX "WikiRevision_pageId_savedAt_idx" ON "WikiRevision"("pageId", "savedAt");
