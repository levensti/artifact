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
}

/* ------------------------------------------------------------------ */
/*  Structured paper representation                                    */
/* ------------------------------------------------------------------ */

/**
 * A section of a parsed paper. Body text is the section's content
 * verbatim; level is 1 for top-level (Introduction) and 2/3 for nested.
 */
export interface ParsedSection {
  heading: string;
  level: number;
  body: string;
  startPage?: number;
}

/**
 * A bibliographic reference resolved from the paper's reference list.
 * Key matches the in-text citation form (e.g. "[27]" or "Vaswani2017").
 */
export interface ParsedReference {
  key: string;
  text: string;
  doi?: string;
  arxivId?: string;
}

/** A figure identified by caption. */
export interface ParsedFigure {
  id: string;
  caption: string;
  page?: number;
}

/** A table identified by caption. Same shape as ParsedFigure. */
export type ParsedTable = ParsedFigure;

/**
 * Structured representation of a paper, produced by the parsing endpoint
 * and cached per content hash in IndexedDB. Used by section-aware tools
 * (read_section, search_paper, lookup_citation) and the L1-card chat
 * strategy for long papers.
 */
export interface ParsedPaper {
  title: string;
  abstract: string;
  sections: ParsedSection[];
  references: ParsedReference[];
  figures: ParsedFigure[];
  /**
   * Tables. Optional for backward compatibility: papers parsed before the
   * tables/figures split shared a single `figures` array, so older cached
   * entries don't have this field. Resolvers fall back to scanning
   * `figures` for `Table N`-prefixed ids when this is missing.
   */
  tables?: ParsedTable[];
  /**
   * 800-1500 word L1 paper card: central claim, methods, key results,
   * novelty, limitations. Always sent to the chat handler in long-paper
   * mode; sections are fetched on demand via tools.
   */
  summary: string;
  parsedAt: string;
  parsedWith: { modelId: string };
}

/**
 * Lightweight citation-to-page mapping for a single paper. Produced by a
 * small LLM call that runs on every paper open (independent of the full
 * `ParsedPaper`). Keys are the citation token as it appears in chat
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
}
