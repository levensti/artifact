import type { ArxivSearchResult } from "@/lib/explore";

/** A text segment in an interleaved agent response. */
export interface TextSegmentBlock {
  type: "text_segment";
  content: string;
}

/** A tool invocation recorded in a chat message. */
export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

/**
 * Structured content rendered in an assistant message.
 * For agentic responses, blocks are stored in display order (text_segment
 * interleaved with tool_call) so the interleaved view survives page reload.
 */
export type ChatAssistantBlock =
  | TextSegmentBlock
  | ToolCallBlock
  | { type: "arxiv_hits"; query: string; results: ArxivSearchResult[] };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Rich panels for learning / literature actions (assistant only). */
  blocks?: ChatAssistantBlock[];
}

/**
 * A compaction record: an LLM recap of the oldest stretch of a conversation,
 * folded in so the model keeps the gist without paying the full token cost.
 * Non-destructive — the raw messages it covers stay in `ReviewMessages.messages`;
 * only the model-facing transcript drops them in favour of `summary`.
 */
export interface CompactionRecord {
  /** Recap markdown of every message up to and including `coveredThroughId`. */
  summary: string;
  /** Id of the last `ChatMessage` folded into `summary`. */
  coveredThroughId: string;
  /** How many leading messages `summary` replaces in the model transcript. */
  coveredCount: number;
  createdAt: string;
}

/**
 * Per-conversation context state persisted alongside the messages
 * (`ReviewMessages.contextMetadata`). Server-authoritative so the usage meter
 * and auto-compaction survive a page refresh.
 */
export interface ContextMetadata {
  compaction?: CompactionRecord;
  /** Measured `prompt_tokens` of the most recent turn (real, not estimated). */
  lastContextTokens?: number;
  /** Snapshot of the model context window, surfaced to the client meter. */
  windowTokens?: number;
  /** Estimated paper-block footprint in context (the uncompactable paper cost). */
  paperTokens?: number;
  /** Estimated fixed overhead: paper + system prompt. Conversation tokens are
   *  `lastContextTokens − overheadTokens`. */
  overheadTokens?: number;
}

/**
 * The slice of context state the client needs for the usage meter and
 * auto-compaction. Derived server-side (the compaction threshold lives in
 * server-only config) so the browser never gets the recap text or the
 * threshold logic — just numbers and a verdict.
 */
export interface ContextUsage {
  usedTokens: number;
  windowTokens: number;
  shouldCompact: boolean;
  /** Estimated paper-block footprint in context (uncompactable). */
  paperTokens?: number;
  /** Estimated fixed overhead (paper + system prompt). */
  overheadTokens?: number;
}

/**
 * Lightweight citation-to-page mapping for a single paper. Produced by a
 * small LLM call that runs on every short paper open. Keys are the
 * citation token as it appears in chat
 * (e.g. "3.2" for a section, "1" for "Figure 1"); values are PDF page
 * numbers. Newer maps also carry short evidence snippets copied from the
 * mapped page; the citation resolver uses those as precise scroll anchors.
 */
export interface PageMap {
  sections: Record<string, number>;
  figures: Record<string, number>;
  tables: Record<string, number>;
  anchors?: {
    sections: Record<string, string>;
    figures: Record<string, string>;
    tables: Record<string, string>;
  };
  /**
   * The paper's title, as the model read it off the first page. Optional —
   * older cached page maps predate this field. Used to write the real
   * title back to the review row when creation only had a placeholder
   * (e.g. arXiv metadata fetch failed, local PDF filename, web hostname).
   */
  title?: string;
}

/** A saved paper review session: PDF / web page + replayable Q&A. */
export interface PaperReview {
  id: string;
  title: string;
  /** arXiv paper ID. Null for locally-uploaded PDFs and web pages. */
  arxivId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Absolute filesystem path for local PDFs. Null for arXiv papers and web pages. */
  pdfPath: string | null;
  /** Source URL for arbitrary web pages. Null for arXiv papers and local PDFs. */
  sourceUrl: string | null;
  /** ISO timestamp set when this review arrived via share-bundle import. Drives the sidebar "Imported" badge. */
  importedAt?: string;
  /** Token of the share that produced this clone, when imported via a share link. */
  importedFromShareToken?: string;
  /** Display name of the sharer at clone time. Snapshot — survives revocation/rename. */
  importedFromName?: string;
  /** Project this review belongs to. Null = ungrouped. */
  projectId?: string | null;
  /** Content-addressed document this review reads, once linked (set on the
   *  first open after upload). Lets a reopen skip text extraction. */
  documentId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}
