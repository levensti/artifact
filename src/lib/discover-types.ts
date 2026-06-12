/**
 * Wire types for the Discover queue (server ↔ client).
 *
 * `DiscoverQuery` is a single user-issued discovery turn. `Recommendation`
 * is one curated paper pick produced for that query — the first-class
 * triage entity.
 */

export type DiscoverQueryStatus = "running" | "complete" | "errored";

export interface DiscoverQuery {
  id: string;
  query: string;
  /** Auxiliary text (Plan + Filter line) the agent emitted alongside the picks. */
  notes: string | null;
  status: DiscoverQueryStatus;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  queryId: string;
  /** 1-indexed position in the agent's submit_picks list. */
  rank: number;
  url: string;
  title: string;
  rationale: string;
  arxivId: string | null;
  authors: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  venue: string | null;
  citationCount: number | null;
  dismissedAt: string | null;
  createdAt: string;
}
