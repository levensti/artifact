/**
 * Client-side cache + HTTP bridge to SQLite-backed /api/data routes.
 */

import type { Provider } from "@/lib/models";
import type { Model } from "@/lib/models";
import type { PaperReview, ChatMessage } from "@/lib/review-types";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type {
  GlobalGraphData,
  GraphData,
  PrerequisitesData,
} from "@/lib/explore";
import { mergeGlobalGraphSession } from "@/lib/explore-merge";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
  EXPLORE_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
} from "@/lib/storage-events";

async function apiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/data${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const looksHtml =
      text.includes("<!DOCTYPE") || text.trimStart().startsWith("<!");
    throw new Error(
      looksHtml
        ? `Request failed: ${res.status} ${res.statusText} (${path})`
        : text || res.statusText,
    );
  }
  return res.json() as Promise<T>;
}

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

let reviewsCache: PaperReview[] = [];
let settingsCache: {
  keys: Partial<Record<Provider, string>>;
  selectedModel: Model | null;
} = { keys: {}, selectedModel: null };
let globalGraphCache: GlobalGraphData | null = null;
let deepDivesCache: DeepDiveSession[] = [];

const messagesCache = new Map<string, ChatMessage[]>();
const annotationsCache = new Map<string, Annotation[]>();
const exploreCache = new Map<
  string,
  { prerequisites: PrerequisitesData | null; graph: GraphData | null }
>();

export function isDataHydrated(): boolean {
  return hydrated;
}

export async function hydrateClientStore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const boot = await apiJson<{
      reviews: PaperReview[];
      settings: {
        keys: Partial<Record<Provider, string>>;
        selectedModel: Model | null;
      };
      globalGraph: GlobalGraphData | null;
      deepDives: DeepDiveSession[];
    }>("/bootstrap");
    reviewsCache = boot.reviews;
    settingsCache = boot.settings;
    globalGraphCache = boot.globalGraph;
    deepDivesCache = boot.deepDives;
    messagesCache.clear();
    annotationsCache.clear();
    exploreCache.clear();
    hydrated = true;
    window.dispatchEvent(new Event(REVIEWS_UPDATED_EVENT));
    window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
    window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
    window.dispatchEvent(new Event(DEEP_DIVES_UPDATED_EVENT));
  })();
  return hydratePromise;
}

/* ── Reviews ── */

export function getReviewsSnapshot(): PaperReview[] {
  return reviewsCache;
}

export async function refreshReviews(): Promise<void> {
  reviewsCache = await apiJson<PaperReview[]>("/reviews");
  window.dispatchEvent(new Event(REVIEWS_UPDATED_EVENT));
}

export function getReview(id: string): PaperReview | undefined {
  return reviewsCache.find((r) => r.id === id);
}

export async function createReview(
  arxivId: string,
  title: string,
): Promise<PaperReview> {
  const review = await apiJson<PaperReview>("/reviews", {
    method: "POST",
    body: JSON.stringify({ arxivId, title }),
  });
  await refreshReviews();
  return review;
}

/* ── Messages ── */

export async function loadMessages(reviewId: string): Promise<ChatMessage[]> {
  if (!reviewId?.trim()) return [];
  const cached = messagesCache.get(reviewId);
  if (cached) return cached;
  const list = await apiJson<ChatMessage[]>(
    `/reviews/${encodeURIComponent(reviewId)}/messages`,
  );
  messagesCache.set(reviewId, list);
  return list;
}

export async function saveMessages(
  reviewId: string,
  messages: ChatMessage[],
): Promise<void> {
  messagesCache.set(reviewId, messages);
  await apiJson(`/reviews/${encodeURIComponent(reviewId)}/messages`, {
    method: "PUT",
    body: JSON.stringify({ messages }),
  });
}

/* ── Annotations ── */

export async function loadAnnotations(reviewId: string): Promise<Annotation[]> {
  if (!reviewId?.trim()) return [];
  const cached = annotationsCache.get(reviewId);
  if (cached) return cached;
  const list = await apiJson<Annotation[]>(
    `/reviews/${encodeURIComponent(reviewId)}/annotations`,
  );
  annotationsCache.set(reviewId, list);
  return list;
}

export async function saveAnnotations(
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  annotationsCache.set(reviewId, annotations);
  await apiJson(`/reviews/${encodeURIComponent(reviewId)}/annotations`, {
    method: "PUT",
    body: JSON.stringify({ annotations }),
  });
  window.dispatchEvent(new Event(ANNOTATIONS_UPDATED_EVENT));
}

/* ── Deep dives ── */

export function getDeepDivesSnapshot(): DeepDiveSession[] {
  return deepDivesCache;
}

export async function refreshDeepDives(): Promise<void> {
  deepDivesCache = await apiJson<DeepDiveSession[]>("/deep-dives");
  window.dispatchEvent(new Event(DEEP_DIVES_UPDATED_EVENT));
}

export async function saveDeepDive(
  payload: Omit<DeepDiveSession, "id" | "createdAt">,
): Promise<DeepDiveSession> {
  const session = await apiJson<DeepDiveSession>("/deep-dives", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  deepDivesCache = [session, ...deepDivesCache.filter((d) => d.id !== session.id)];
  window.dispatchEvent(new Event(DEEP_DIVES_UPDATED_EVENT));
  return session;
}

/* ── Explore ── */

export async function loadExplore(
  reviewId: string,
): Promise<{
  prerequisites: PrerequisitesData | null;
  graph: GraphData | null;
}> {
  if (!reviewId?.trim()) {
    return { prerequisites: null, graph: null };
  }
  const cached = exploreCache.get(reviewId);
  if (cached) return cached;
  const data = await apiJson<{
    prerequisites: PrerequisitesData | null;
    graph: GraphData | null;
  }>(`/explore/${encodeURIComponent(reviewId)}`);
  exploreCache.set(reviewId, data);
  return data;
}

export function getExploreCached(reviewId: string): {
  prerequisites: PrerequisitesData | null;
  graph: GraphData | null;
} | undefined {
  return exploreCache.get(reviewId);
}

export async function savePrerequisites(
  reviewId: string,
  prerequisites: PrerequisitesData,
): Promise<void> {
  const prev = exploreCache.get(reviewId) ?? {
    prerequisites: null,
    graph: null,
  };
  const next = { ...prev, prerequisites };
  exploreCache.set(reviewId, next);
  await apiJson(`/explore/${encodeURIComponent(reviewId)}`, {
    method: "PUT",
    body: JSON.stringify({ prerequisites }),
  });
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export async function saveGraphData(
  reviewId: string,
  graph: GraphData,
): Promise<void> {
  const prev = exploreCache.get(reviewId) ?? {
    prerequisites: null,
    graph: null,
  };
  const next = { ...prev, graph };
  exploreCache.set(reviewId, next);
  await apiJson(`/explore/${encodeURIComponent(reviewId)}`, {
    method: "PUT",
    body: JSON.stringify({ graph }),
  });
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export async function mergeSessionGraphIntoGlobal(
  anchorReviewId: string,
  graph: GraphData,
): Promise<void> {
  const next = mergeGlobalGraphSession(
    anchorReviewId,
    graph,
    globalGraphCache,
  );
  globalGraphCache = next;
  await apiJson("/explore/global", {
    method: "PUT",
    body: JSON.stringify(next),
  });
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export function getGlobalGraphData(): GlobalGraphData | null {
  return globalGraphCache;
}

export async function refreshGlobalGraph(): Promise<void> {
  globalGraphCache = await apiJson<GlobalGraphData | null>("/explore/global");
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export async function clearExploreData(reviewId: string): Promise<void> {
  exploreCache.delete(reviewId);
  await apiJson(`/explore/${encodeURIComponent(reviewId)}`, {
    method: "DELETE",
  });
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export async function clearGlobalKnowledgeGraph(): Promise<void> {
  globalGraphCache = null;
  await apiJson("/explore/global", { method: "DELETE" });
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

/* ── Settings / keys ── */

export function getApiKey(provider: Provider): string | null {
  return settingsCache.keys[provider] ?? null;
}

export function hasAnySavedApiKey(): boolean {
  const k = settingsCache.keys;
  return (
    !!k.anthropic ||
    !!k.openai ||
    !!k.xai ||
    !!k.openrouter
  );
}

export async function setApiKey(provider: Provider, key: string): Promise<void> {
  settingsCache = await apiJson<typeof settingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ keys: { [provider]: key } }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export async function clearApiKey(provider: Provider): Promise<void> {
  settingsCache = await apiJson<typeof settingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ keys: { [provider]: null } }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export async function saveSelectedModel(model: Model | null): Promise<void> {
  settingsCache = await apiJson<typeof settingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ selectedModel: model }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export function getSavedSelectedModel(): Model | null {
  const m = settingsCache.selectedModel;
  if (!m) return null;
  if (!getApiKey(m.provider)) return null;
  return m;
}

export async function refreshSettingsFromServer(): Promise<void> {
  settingsCache = await apiJson<typeof settingsCache>("/settings");
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}
