/**
 * Client-side cache + HTTP bridge to SQLite-backed /api/data routes.
 */

import type { InferenceProviderProfile, Provider } from "@/lib/models";
import type { Model } from "@/lib/models";
import {
  BUILTIN_PROVIDER_ORDER,
  isInferenceProviderType,
} from "@/lib/models";
import type { PaperReview, ChatMessage } from "@/lib/review-types";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type {
  GlobalGraphData,
  GraphData,
  PrerequisitesData,
} from "@/lib/explore";
import { mergeGlobalGraphSession } from "@/lib/explore-merge";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
  EXPLORE_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
  WIKI_UPDATED_EVENT,
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

type SettingsCache = {
  keys: Partial<Record<Provider, string>>;
  inferenceProfiles: InferenceProviderProfile[];
  selectedModel: Model | null;
};

let settingsCache: SettingsCache = {
  keys: {},
  inferenceProfiles: [],
  selectedModel: null,
};
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
      settings: SettingsCache;
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

export async function createLocalPdfReview(
  pdfPath: string,
  title: string,
): Promise<PaperReview> {
  const review = await apiJson<PaperReview>("/reviews", {
    method: "POST",
    body: JSON.stringify({ pdfPath, title }),
  });
  await refreshReviews();
  return review;
}

export async function createWebReview(
  sourceUrl: string,
  title: string,
): Promise<PaperReview> {
  const review = await apiJson<PaperReview>("/reviews", {
    method: "POST",
    body: JSON.stringify({ sourceUrl, title }),
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

/**
 * Invalidate the client-side explore cache for a review so the next
 * read re-fetches from the server. Used after the assistant's
 * save_to_knowledge_graph tool writes directly to the DB.
 */
export function invalidateExploreCache(reviewId: string): void {
  exploreCache.delete(reviewId);
  globalGraphCache = null;
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

/* ── Wiki (ambient knowledge base) ──────────────────────────────── */
/**
 * Client bridge to the SQLite-backed /api/data/wiki/* routes. The cache
 * is optimistic: mutations update local state immediately and dispatch
 * WIKI_UPDATED_EVENT so `useSyncExternalStore` subscribers (sidebar,
 * browse page) re-render without waiting for the next fetch.
 */

let wikiPagesCache: WikiPage[] | null = null;
let wikiPagesInflight: Promise<WikiPage[]> | null = null;
const wikiIngestedCache = new Map<string, boolean>();

function notifyWikiUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WIKI_UPDATED_EVENT));
}

function upsertWikiPageInCache(page: WikiPage): void {
  if (!wikiPagesCache) {
    wikiPagesCache = [page];
    return;
  }
  const idx = wikiPagesCache.findIndex((p) => p.slug === page.slug);
  if (idx >= 0) {
    wikiPagesCache = [
      ...wikiPagesCache.slice(0, idx),
      page,
      ...wikiPagesCache.slice(idx + 1),
    ];
  } else {
    wikiPagesCache = [...wikiPagesCache, page];
  }
}

/** Synchronous snapshot for useSyncExternalStore. null until first load. */
export function getWikiCacheSnapshot(): WikiPage[] | null {
  return wikiPagesCache;
}

/** Fetch all wiki pages (cached). Safe to call repeatedly. */
export async function loadWikiPages(): Promise<WikiPage[]> {
  if (wikiPagesCache) return wikiPagesCache;
  if (wikiPagesInflight) return wikiPagesInflight;
  wikiPagesInflight = (async () => {
    try {
      const list = await apiJson<WikiPage[]>("/wiki");
      wikiPagesCache = list;
      notifyWikiUpdated();
      return list;
    } finally {
      wikiPagesInflight = null;
    }
  })();
  return wikiPagesInflight;
}

/** Fetch a single wiki page by slug, or null if it doesn't exist. */
export async function loadWikiPage(slug: string): Promise<WikiPage | null> {
  if (!slug?.trim()) return null;
  // Prefer cache if we have a full list.
  if (wikiPagesCache) {
    const hit = wikiPagesCache.find((p) => p.slug === slug);
    if (hit) return hit;
  }
  try {
    const page = await apiJson<WikiPage>(
      `/wiki/${encodeURIComponent(slug)}`,
    );
    upsertWikiPageInCache(page);
    return page;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      return null;
    }
    throw err;
  }
}

export interface SaveWikiPageInput {
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
  /** Optional: link this page to a review/paper as a source. */
  reviewId?: string;
}

/** Create or upsert a wiki page. Always dispatches WIKI_UPDATED_EVENT. */
export async function saveWikiPage(
  input: SaveWikiPageInput,
): Promise<WikiPage> {
  const page = await apiJson<WikiPage>("/wiki", {
    method: "POST",
    body: JSON.stringify(input),
  });
  upsertWikiPageInCache(page);
  if (input.reviewId) wikiIngestedCache.set(input.reviewId, true);
  notifyWikiUpdated();
  return page;
}

/** Partial update of an existing wiki page. */
export async function updateWikiPage(
  slug: string,
  patch: { title?: string; content?: string; pageType?: WikiPageType },
): Promise<WikiPage> {
  const page = await apiJson<WikiPage>(
    `/wiki/${encodeURIComponent(slug)}`,
    {
      method: "PUT",
      body: JSON.stringify(patch),
    },
  );
  upsertWikiPageInCache(page);
  notifyWikiUpdated();
  return page;
}

/** Delete a wiki page by slug. */
export async function deleteWikiPage(slug: string): Promise<void> {
  await apiJson(`/wiki/${encodeURIComponent(slug)}`, { method: "DELETE" });
  if (wikiPagesCache) {
    wikiPagesCache = wikiPagesCache.filter((p) => p.slug !== slug);
  }
  notifyWikiUpdated();
}

/** Has this review already been ingested into the wiki? */
export async function checkWikiIngested(reviewId: string): Promise<boolean> {
  if (!reviewId?.trim()) return false;
  const cached = wikiIngestedCache.get(reviewId);
  if (cached !== undefined) return cached;
  const res = await apiJson<{ ingested: boolean }>(
    `/wiki/check?reviewId=${encodeURIComponent(reviewId)}`,
  );
  wikiIngestedCache.set(reviewId, res.ingested);
  return res.ingested;
}

/**
 * Clear local wiki cache and notify subscribers. Used by ingest
 * pipelines after they finish writing so readers re-fetch fresh data.
 */
export function invalidateWikiCache(): void {
  wikiPagesCache = null;
  wikiPagesInflight = null;
  notifyWikiUpdated();
}

/* ── Settings / keys ── */

export function getApiKey(provider: Provider): string | null {
  return settingsCache.keys[provider] ?? null;
}

export function getInferenceProfiles(): InferenceProviderProfile[] {
  return settingsCache.inferenceProfiles;
}

export function getInferenceProfile(
  id: string,
): InferenceProviderProfile | undefined {
  return settingsCache.inferenceProfiles.find((p) => p.id === id);
}

/** Built-in provider (Anthropic, OpenAI, …) has a saved key. */
export function isBuiltinProviderReady(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return !!getApiKey(provider);
}

/** Model can be used for API calls (built-in key or inference profile complete). */
export function isModelReady(model: Model): boolean {
  if (isInferenceProviderType(model.provider)) {
    if (!model.profileId) return false;
    const p = getInferenceProfile(model.profileId);
    return !!(p?.apiKey?.trim() && p?.baseUrl?.trim() && p?.label?.trim());
  }
  return isBuiltinProviderReady(model.provider);
}

/** @deprecated prefer isBuiltinProviderReady or isModelReady */
export function isProviderReady(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return isBuiltinProviderReady(provider);
}

export function hasAnySavedApiKey(): boolean {
  for (const p of BUILTIN_PROVIDER_ORDER) {
    if (getApiKey(p)) return true;
  }
  return settingsCache.inferenceProfiles.some(
    (x) => x.apiKey.trim() && x.baseUrl.trim(),
  );
}

export async function setApiKey(provider: Provider, key: string): Promise<void> {
  settingsCache = await apiJson<SettingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ keys: { [provider]: key } }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export async function saveInferenceProfiles(
  profiles: InferenceProviderProfile[],
): Promise<void> {
  settingsCache = await apiJson<SettingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ inferenceProfiles: profiles }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export async function clearApiKey(provider: Provider): Promise<void> {
  settingsCache = await apiJson<SettingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ keys: { [provider]: null } }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export async function saveSelectedModel(model: Model | null): Promise<void> {
  settingsCache = await apiJson<SettingsCache>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ selectedModel: model }),
  });
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export function getSavedSelectedModel(): Model | null {
  const m = settingsCache.selectedModel;
  if (!m) return null;
  return isModelReady(m) ? m : null;
}

export async function refreshSettingsFromServer(): Promise<void> {
  settingsCache = await apiJson<SettingsCache>("/settings");
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}
