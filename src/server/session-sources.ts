import "server-only";
import { prisma } from "./db";
import type { Annotation } from "@/lib/annotations";
import type { ChatMessage } from "@/lib/review-types";

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

/**
 * Everything touched at or after `sinceIso`. Caps per-review chat and
 * annotations to keep the prompt under budget.
 */
export async function getRecentActivity(
  userId: string,
  sinceIso: string,
): Promise<RecentActivity> {
  const since = new Date(sinceIso);
  const reviews = await prisma.review.findMany({
    where: { userId },
    include: { messages: true, annotations: true },
  });

  const touched: SessionSourceReview[] = [];
  const chatMessages: SessionSourceChatMessage[] = [];
  const annotations: SessionSourceAnnotation[] = [];
  let latest: string | null = null;
  const bump = (iso: string | null | undefined) => {
    if (iso && (latest === null || iso > latest)) latest = iso;
  };
  const after = (iso: string | null | undefined) =>
    !!iso && new Date(iso) >= since;

  for (const r of reviews) {
    const allMsgs = (r.messages?.messages as unknown as ChatMessage[] | null) ?? [];
    const msgs = allMsgs
      .filter((m) => after(m.timestamp))
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

    const allAnns =
      (r.annotations?.annotations as unknown as Annotation[] | null) ?? [];
    const anns = allAnns
      .filter((a) => after(a.createdAt))
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

    const createdSince = r.createdAt >= since;
    const updatedSince = r.updatedAt >= since;
    if (createdSince || updatedSince || msgs.length > 0 || anns.length > 0) {
      if (createdSince) bump(r.createdAt.toISOString());
      if (updatedSince) bump(r.updatedAt.toISOString());
      touched.push({
        reviewId: r.id,
        title: r.title,
        arxivId: r.arxivId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        isNewSinceWindow: createdSince,
      });
    }
  }

  const ddRows = await prisma.deepDive.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const deepDives: SessionSourceDeepDive[] = ddRows.map((d) => {
    const iso = d.createdAt.toISOString();
    bump(iso);
    return {
      id: d.id,
      reviewId: d.reviewId,
      paperTitle: d.paperTitle,
      topic: d.topic,
      explanation: d.explanation.slice(0, 800),
      createdAt: iso,
    };
  });

  return {
    since: sinceIso,
    latestActivityAt: latest,
    reviews: touched,
    annotations,
    chatMessages,
    deepDives,
    isEmpty:
      touched.length === 0 &&
      annotations.length === 0 &&
      chatMessages.length === 0 &&
      deepDives.length === 0,
  };
}
