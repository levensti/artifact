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
import type { WikiArticle } from "@/lib/wiki";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
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
let deepDivesCache: DeepDiveSession[] = [];
let wikiArticlesCache: WikiArticle[] = [];

const messagesCache = new Map<string, ChatMessage[]>();
const annotationsCache = new Map<string, Annotation[]>();

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
      deepDives: DeepDiveSession[];
      wikiArticles: WikiArticle[];
    }>("/bootstrap");
    reviewsCache = boot.reviews;
    settingsCache = boot.settings;
    deepDivesCache = boot.deepDives;
    wikiArticlesCache = boot.wikiArticles ?? [];
    messagesCache.clear();
    annotationsCache.clear();
    hydrated = true;
    window.dispatchEvent(new Event(REVIEWS_UPDATED_EVENT));
    window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
    window.dispatchEvent(new Event(DEEP_DIVES_UPDATED_EVENT));
    window.dispatchEvent(new Event(WIKI_UPDATED_EVENT));
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

/* ── Wiki articles ── */

export function getWikiArticlesSnapshot(): WikiArticle[] {
  return wikiArticlesCache;
}

export function getWikiArticle(slug: string): WikiArticle | undefined {
  return wikiArticlesCache.find((a) => a.slug === slug);
}

export async function refreshWikiArticles(): Promise<void> {
  wikiArticlesCache = await apiJson<WikiArticle[]>("/wiki");
  window.dispatchEvent(new Event(WIKI_UPDATED_EVENT));
}

export async function saveWikiArticle(article: WikiArticle): Promise<void> {
  await apiJson(`/wiki/${encodeURIComponent(article.slug)}`, {
    method: "PUT",
    body: JSON.stringify(article),
  });
  const idx = wikiArticlesCache.findIndex((a) => a.slug === article.slug);
  if (idx >= 0) {
    wikiArticlesCache = [
      ...wikiArticlesCache.slice(0, idx),
      article,
      ...wikiArticlesCache.slice(idx + 1),
    ];
  } else {
    wikiArticlesCache = [...wikiArticlesCache, article];
  }
  window.dispatchEvent(new Event(WIKI_UPDATED_EVENT));
}

export async function deleteWikiArticle(slug: string): Promise<void> {
  await apiJson(`/wiki/${encodeURIComponent(slug)}`, { method: "DELETE" });
  wikiArticlesCache = wikiArticlesCache.filter((a) => a.slug !== slug);
  window.dispatchEvent(new Event(WIKI_UPDATED_EVENT));
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
