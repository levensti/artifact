/**
 * Client wrapper for the journal agent's recent-activity feed. Hits the
 * server route, which runs the same aggregation against Postgres.
 */

import { apiFetch } from "@/lib/client/api";
import type { WikiPage } from "@/lib/wiki";

export interface SessionSourceReview {
  reviewId: string;
  title: string;
  arxivId: string | null;
  createdAt: string;
  updatedAt: string;
  isNewSinceWindow: boolean;
}

export interface SessionSourceChatMessage {
  id: string;
  reviewId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionSourceAnnotation {
  id: string;
  reviewId: string;
  highlightText: string;
  note: string;
  kind: string;
  createdAt: string;
}

export interface SessionSourceDeepDive {
  id: string;
  reviewId: string;
  paperTitle: string;
  topic: string;
  explanation: string;
  createdAt: string;
}

export interface RecentActivity {
  since: string;
  latestActivityAt: string | null;
  reviews: SessionSourceReview[];
  annotations: SessionSourceAnnotation[];
  chatMessages: SessionSourceChatMessage[];
  deepDives: SessionSourceDeepDive[];
  isEmpty: boolean;
}

/** Everything touched at or after `sinceIso`. */
export async function getRecentActivity(
  sinceIso: string,
): Promise<RecentActivity> {
  const { activity } = await apiFetch<{ activity: RecentActivity }>(
    `/api/session-sources/recent?since=${encodeURIComponent(sinceIso)}`,
  );
  return activity;
}

/** Session pages whose date-keyed slugs fall within the inclusive range. */
export async function listSessionPagesInRange(
  startDateKey: string,
  endDateKey: string,
): Promise<
  Array<Pick<WikiPage, "slug" | "title" | "content" | "updatedAt">>
> {
  const { pages } = await apiFetch<{
    pages: Array<Pick<WikiPage, "slug" | "title" | "content" | "updatedAt">>;
  }>(
    `/api/wiki/sessions?start=${encodeURIComponent(startDateKey)}&end=${encodeURIComponent(endDateKey)}`,
  );
  return pages;
}
