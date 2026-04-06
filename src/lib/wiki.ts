/** Types for the LLM-compiled concept wiki. */

export interface WikiArticle {
  id: string;
  slug: string;
  title: string;
  /** e.g. "concepts", "methods", "datasets", "comparisons", "architectures" */
  category: string;
  /** LLM-generated markdown content with backlinks */
  contentMd: string;
  /** One-line summary for the wiki index (used by LLM to navigate) */
  summary: string;
  /** Review IDs whose papers contributed to this article */
  sourceReviewIds: string[];
  /** Slugs of other wiki articles this one links to */
  relatedSlugs: string[];
  generatedAt: string;
  updatedAt: string;
}

/** Lightweight index entry — the full index is small enough for LLM context. */
export interface WikiIndexEntry {
  slug: string;
  title: string;
  category: string;
  summary: string;
}

export { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
