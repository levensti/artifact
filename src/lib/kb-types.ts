/** Knowledge Base types — wiki pages, sources, and activity log. */

export type WikiPageType =
  | "concept"
  | "method"
  | "result"
  | "paper-summary"
  | "topic";

export const WIKI_PAGE_TYPES: WikiPageType[] = [
  "concept",
  "method",
  "result",
  "paper-summary",
  "topic",
];

export interface WikiPage {
  id: string;
  slug: string;
  title: string;
  /** Markdown content with optional YAML frontmatter. */
  content: string;
  pageType: WikiPageType;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WikiPageSource {
  pageId: string;
  reviewId: string;
  contributedAt: string;
}

export type KbLogAction = "ingest" | "update" | "create" | "lint";

export interface KbLogEntry {
  id: string;
  action: KbLogAction;
  description: string;
  affectedPageIds: string[];
  reviewId?: string;
  createdAt: string;
}

export { KB_UPDATED_EVENT } from "@/lib/storage-events";
