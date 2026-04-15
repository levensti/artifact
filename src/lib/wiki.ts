/** Wiki page types and interfaces for the ambient knowledge base. */

export type WikiPageType = "session" | "digest";

export interface WikiPage {
  id: string;
  slug: string;
  title: string;
  /** Markdown content with [[slug]] cross-references. */
  content: string;
  pageType: WikiPageType;
  createdAt: string;
  updatedAt: string;
}

export { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
