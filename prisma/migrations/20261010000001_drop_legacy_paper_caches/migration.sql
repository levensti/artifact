-- Second, destructive step: the per-user parse / page-map caches were folded
-- into "Document" by the previous migration and nothing reads them anymore.
DROP TABLE "ParsedPaper";
DROP TABLE "PageMap";
