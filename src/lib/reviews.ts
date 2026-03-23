export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/** A saved paper review session: PDF + replayable Q&A. */
export interface PaperReview {
  id: string;
  title: string;
  arxivId: string;
  createdAt: string;
  updatedAt: string;
}

const REVIEWS_KEY = "paper-copilot-reviews";
const LEGACY_STUDIES_KEY = "paper-copilot-studies";
const MESSAGES_KEY_PREFIX = "paper-copilot-messages-";

export const REVIEWS_UPDATED_EVENT = "paper-copilot-reviews-updated";

function migrateLegacyIfNeeded(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(REVIEWS_KEY)) return;
  const legacy = localStorage.getItem(LEGACY_STUDIES_KEY);
  if (legacy) localStorage.setItem(REVIEWS_KEY, legacy);
}

export function getReviews(): PaperReview[] {
  if (typeof window === "undefined") return [];
  migrateLegacyIfNeeded();
  const raw = localStorage.getItem(REVIEWS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PaperReview[];
  } catch {
    return [];
  }
}

export function getReview(id: string): PaperReview | undefined {
  return getReviews().find((r) => r.id === id);
}

export function createReview(arxivId: string, title: string): PaperReview {
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title,
    arxivId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const list = getReviews();
  list.unshift(review);
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(list));
  return review;
}

export function deleteReview(id: string): void {
  const list = getReviews().filter((r) => r.id !== id);
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(list));
  localStorage.removeItem(`${MESSAGES_KEY_PREFIX}${id}`);
}

export function getMessages(reviewId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`${MESSAGES_KEY_PREFIX}${reviewId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export function saveMessages(reviewId: string, messages: ChatMessage[]): void {
  localStorage.setItem(
    `${MESSAGES_KEY_PREFIX}${reviewId}`,
    JSON.stringify(messages),
  );
}
