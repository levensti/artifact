/**
 * Aggregates the user's research activity for the journal agent. Pure read —
 * no writes. Supports two modes:
 *   • single-day (legacy, still used by a couple of callers)
 *   • since-window (the agentic path: everything after a given ISO timestamp).
 */

import {
  listReviews,
  getMessages,
  getAnnotations,
  listDeepDives,
  listSessionPagesInRange,
} from "@/lib/server/store";

export interface SessionSourceReview {
  reviewId: string;
  title: string;
  arxivId: string | null;
  createdAt: string;
  updatedAt: string;
  isNew: boolean;
}

export interface SessionSourceAnnotation {
  id: string;
  reviewId: string;
  highlightText: string;
  note: string;
  kind: string;
  createdAt: string;
}

export interface SessionSourceChatMessage {
  id: string;
  reviewId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionSourceDeepDive {
  id: string;
  reviewId: string;
  paperTitle: string;
  topic: string;
  explanation: string;
  createdAt: string;
}

export interface SessionSources {
  date: string;
  reviews: SessionSourceReview[];
  annotations: SessionSourceAnnotation[];
  chatMessages: SessionSourceChatMessage[];
  deepDives: SessionSourceDeepDive[];
  isEmpty: boolean;
}

function onLocalDate(iso: string, dateKey: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}` === dateKey;
}

export function getSessionSources(dateKey: string): SessionSources {
  const reviews = listReviews();
  const touchedReviews: SessionSourceReview[] = [];
  const chatMessages: SessionSourceChatMessage[] = [];
  const annotations: SessionSourceAnnotation[] = [];

  for (const r of reviews) {
    const createdToday = onLocalDate(r.createdAt, dateKey);
    const updatedToday = onLocalDate(r.updatedAt, dateKey);

    const msgs = getMessages(r.id);
    const todaysMsgs = msgs.filter((m) => onLocalDate(m.timestamp, dateKey));
    for (const m of todaysMsgs) {
      chatMessages.push({
        id: m.id,
        reviewId: r.id,
        role: m.role,
        content: m.content.slice(0, 1200),
        timestamp: m.timestamp,
      });
    }

    const anns = getAnnotations(r.id);
    const todaysAnns = anns.filter((a) => onLocalDate(a.createdAt, dateKey));
    for (const a of todaysAnns) {
      annotations.push({
        id: a.id,
        reviewId: r.id,
        highlightText: a.highlightText.slice(0, 400),
        note: (a.note ?? "").slice(0, 400),
        kind: a.kind ?? "comment",
        createdAt: a.createdAt,
      });
    }

    if (
      createdToday ||
      updatedToday ||
      todaysMsgs.length > 0 ||
      todaysAnns.length > 0
    ) {
      touchedReviews.push({
        reviewId: r.id,
        title: r.title,
        arxivId: r.arxivId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        isNew: createdToday,
      });
    }
  }

  const deepDives: SessionSourceDeepDive[] = listDeepDives()
    .filter((d) => onLocalDate(d.createdAt, dateKey))
    .map((d) => ({
      id: d.id,
      reviewId: d.reviewId,
      paperTitle: d.paperTitle,
      topic: d.topic,
      explanation: d.explanation.slice(0, 800),
      createdAt: d.createdAt,
    }));

  const isEmpty =
    touchedReviews.length === 0 &&
    annotations.length === 0 &&
    chatMessages.length === 0 &&
    deepDives.length === 0;

  return {
    date: dateKey,
    reviews: touchedReviews,
    annotations,
    chatMessages,
    deepDives,
    isEmpty,
  };
}

export interface RecentActivity {
  since: string;
  latestActivityAt: string | null;
  reviews: Array<{
    reviewId: string;
    title: string;
    arxivId: string | null;
    createdAt: string;
    updatedAt: string;
    isNewSinceWindow: boolean;
  }>;
  annotations: SessionSourceAnnotation[];
  chatMessages: SessionSourceChatMessage[];
  deepDives: SessionSourceDeepDive[];
  isEmpty: boolean;
}

function afterIso(iso: string | null | undefined, sinceIso: string): boolean {
  if (!iso) return false;
  return iso >= sinceIso;
}

/**
 * Everything touched at or after `sinceIso`. Used by the journal agent to
 * decide what (if anything) to write. Caps per-review chat/annotations to
 * keep the prompt under budget.
 */
export function getRecentActivity(sinceIso: string): RecentActivity {
  const reviews = listReviews();
  const touchedReviews: RecentActivity["reviews"] = [];
  const chatMessages: SessionSourceChatMessage[] = [];
  const annotations: SessionSourceAnnotation[] = [];
  let latest: string | null = null;
  const bump = (iso: string) => {
    if (iso && (latest === null || iso > latest)) latest = iso;
  };

  for (const r of reviews) {
    const createdSince = afterIso(r.createdAt, sinceIso);
    const updatedSince = afterIso(r.updatedAt, sinceIso);

    const msgs = getMessages(r.id)
      .filter((m) => afterIso(m.timestamp, sinceIso))
      .slice(-60);
    for (const m of msgs) {
      bump(m.timestamp);
      chatMessages.push({
        id: m.id,
        reviewId: r.id,
        role: m.role,
        content: m.content.slice(0, 1200),
        timestamp: m.timestamp,
      });
    }

    const anns = getAnnotations(r.id)
      .filter((a) => afterIso(a.createdAt, sinceIso))
      .slice(-40);
    for (const a of anns) {
      bump(a.createdAt);
      annotations.push({
        id: a.id,
        reviewId: r.id,
        highlightText: a.highlightText.slice(0, 400),
        note: (a.note ?? "").slice(0, 400),
        kind: a.kind ?? "comment",
        createdAt: a.createdAt,
      });
    }

    if (createdSince || updatedSince || msgs.length > 0 || anns.length > 0) {
      if (createdSince) bump(r.createdAt);
      if (updatedSince) bump(r.updatedAt);
      touchedReviews.push({
        reviewId: r.id,
        title: r.title,
        arxivId: r.arxivId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        isNewSinceWindow: createdSince,
      });
    }
  }

  const deepDives: SessionSourceDeepDive[] = listDeepDives()
    .filter((d) => afterIso(d.createdAt, sinceIso))
    .map((d) => {
      bump(d.createdAt);
      return {
        id: d.id,
        reviewId: d.reviewId,
        paperTitle: d.paperTitle,
        topic: d.topic,
        explanation: d.explanation.slice(0, 800),
        createdAt: d.createdAt,
      };
    });

  const isEmpty =
    touchedReviews.length === 0 &&
    annotations.length === 0 &&
    chatMessages.length === 0 &&
    deepDives.length === 0;

  return {
    since: sinceIso,
    latestActivityAt: latest,
    reviews: touchedReviews,
    annotations,
    chatMessages,
    deepDives,
    isEmpty,
  };
}

export { listSessionPagesInRange };
