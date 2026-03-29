import type { ArxivSearchResult } from "@/lib/explore";

/** Structured content rendered under an assistant message (maps, search hits). */
export type ChatAssistantBlock =
  | { type: "learning_embed"; reviewId: string }
  | { type: "arxiv_hits"; query: string; results: ArxivSearchResult[] };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Rich panels for learning / literature actions (assistant only). */
  blocks?: ChatAssistantBlock[];
}

/** A saved paper review session: PDF + replayable Q&A. */
export interface PaperReview {
  id: string;
  title: string;
  arxivId: string;
  createdAt: string;
  updatedAt: string;
}
