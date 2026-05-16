/**
 * Client-side data layer. All reads and writes go through the app's API
 * routes (see src/app/api/*) which back onto Postgres via Prisma.
 *
 * In-memory caches sit in front of the network so that UI render paths
 * can call `getReviewsSnapshot()` / `getWikiCacheSnapshot()` synchronously,
 * the same way they did when the data lived in IndexedDB.
 */

import type { InferenceProviderProfile, Provider } from "@/lib/models";
import type { Model } from "@/lib/models";
import {
  BUILTIN_PROVIDER_ORDER,
  FALLBACK_MODELS,
  isInferenceProviderType,
} from "@/lib/models";
import { hasInferenceCredentials } from "@/lib/ai-providers";
import type { PaperReview, ChatMessage } from "@/lib/review-types";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
  WIKI_UPDATED_EVENT,
  USER_UPDATED_EVENT,
  DISCOVER_UPDATED_EVENT,
} from "@/lib/storage-events";
import { apiFetch } from "@/lib/client/api";

interface SettingsCache {
  keys: Partial<Record<Provider, string>>;
  inferenceProfiles: InferenceProviderProfile[];
  selectedModel: Model | null;
  braveSearchApiKey: string | null;
}

const EMPTY_SETTINGS: SettingsCache = {
  keys: {},
  inferenceProfiles: [],
  selectedModel: null,
  braveSearchApiKey: null,
};

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Which built-in providers have a server-side platform-key fallback. This
 * holds booleans only — the env key never reaches the browser. Lets the UI
 * treat a provider as usable (model picker, chat, etc.) even when the user
 * hasn't brought their own key.
 */
let platformProvidersCache: Partial<Record<Provider, boolean>> = {};

let hydratePromise: Promise<void> | null = null;
let reviewsCache: PaperReview[] = [];
let settingsCache: SettingsCache = EMPTY_SETTINGS;
let deepDivesCache: DeepDiveSession[] = [];
let discoverQueriesCache: DiscoverQuery[] = [];
let recommendationsCache: Recommendation[] = [];
let currentUser: CurrentUser | null = null;

const messagesCache = new Map<string, ChatMessage[]>();
const annotationsCache = new Map<string, Annotation[]>();

function dispatch(name: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export async function hydrateClientStore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const boot = await apiFetch<{
      reviews: PaperReview[];
      settings: SettingsCache;
      platformProviders?: Partial<Record<Provider, boolean>>;
      deepDives: DeepDiveSession[];
      discoverQueries: DiscoverQuery[];
      recommendations: Recommendation[];
      user: CurrentUser | null;
    }>("/api/bootstrap");
    reviewsCache = boot.reviews;
    settingsCache = boot.settings;
    platformProvidersCache = boot.platformProviders ?? {};
    deepDivesCache = boot.deepDives;
    discoverQueriesCache = boot.discoverQueries ?? [];
    recommendationsCache = boot.recommendations ?? [];
    currentUser = boot.user;
    messagesCache.clear();
    annotationsCache.clear();
    dispatch(REVIEWS_UPDATED_EVENT);
    dispatch(KEYS_UPDATED_EVENT);
    dispatch(DEEP_DIVES_UPDATED_EVENT);
    dispatch(DISCOVER_UPDATED_EVENT);
    dispatch(USER_UPDATED_EVENT);
  })();
  return hydratePromise;
}

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}

/* ── Reviews ── */

export function getReviewsSnapshot(): PaperReview[] {
  return reviewsCache;
}

export async function refreshReviews(): Promise<void> {
  const { reviews } = await apiFetch<{ reviews: PaperReview[] }>("/api/reviews");
  reviewsCache = reviews;
  dispatch(REVIEWS_UPDATED_EVENT);
}

export function getReview(id: string): PaperReview | undefined {
  return reviewsCache.find((r) => r.id === id);
}

export async function createReview(
  arxivId: string,
  title: string,
): Promise<PaperReview> {
  const { review } = await apiFetch<{ review: PaperReview }>("/api/reviews", {
    method: "POST",
    body: { kind: "arxiv", arxivId, title },
  });
  await refreshReviews();
  return review;
}

export async function createLocalPdfReview(
  pdfPath: string,
  title: string,
): Promise<PaperReview> {
  const { review } = await apiFetch<{ review: PaperReview }>("/api/reviews", {
    method: "POST",
    body: { kind: "local", pdfPath, title },
  });
  await refreshReviews();
  return review;
}

export async function createWebReview(
  sourceUrl: string,
  title: string,
): Promise<PaperReview> {
  const { review } = await apiFetch<{ review: PaperReview }>("/api/reviews", {
    method: "POST",
    body: { kind: "web", sourceUrl, title },
  });
  await refreshReviews();
  return review;
}

export async function deleteReview(id: string): Promise<void> {
  await apiFetch(`/api/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
  messagesCache.delete(id);
  annotationsCache.delete(id);
  await refreshReviews();
}

/* ── Messages ── */

export async function loadMessages(reviewId: string): Promise<ChatMessage[]> {
  if (!reviewId?.trim()) return [];
  const cached = messagesCache.get(reviewId);
  if (cached) return cached;
  const { messages } = await apiFetch<{ messages: ChatMessage[] }>(
    `/api/reviews/${encodeURIComponent(reviewId)}/messages`,
  );
  messagesCache.set(reviewId, messages);
  return messages;
}

export async function saveMessages(
  reviewId: string,
  messages: ChatMessage[],
): Promise<void> {
  messagesCache.set(reviewId, messages);
  await apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/messages`, {
    method: "PUT",
    body: { messages },
  });
}

/* ── Annotations ── */

export async function loadAnnotations(reviewId: string): Promise<Annotation[]> {
  if (!reviewId?.trim()) return [];
  const cached = annotationsCache.get(reviewId);
  if (cached) return cached;
  const { annotations } = await apiFetch<{ annotations: Annotation[] }>(
    `/api/reviews/${encodeURIComponent(reviewId)}/annotations`,
  );
  annotationsCache.set(reviewId, annotations);
  return annotations;
}

export async function saveAnnotations(
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  annotationsCache.set(reviewId, annotations);
  await apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/annotations`, {
    method: "PUT",
    body: { annotations },
  });
  dispatch(ANNOTATIONS_UPDATED_EVENT);
}

/* ── Deep dives ── */

export function getDeepDivesSnapshot(): DeepDiveSession[] {
  return deepDivesCache;
}

export async function refreshDeepDives(): Promise<void> {
  const { deepDives } = await apiFetch<{ deepDives: DeepDiveSession[] }>(
    "/api/deep-dives",
  );
  deepDivesCache = deepDives;
  dispatch(DEEP_DIVES_UPDATED_EVENT);
}

export async function saveDeepDive(
  payload: Omit<DeepDiveSession, "id" | "createdAt">,
): Promise<DeepDiveSession> {
  const { deepDive } = await apiFetch<{ deepDive: DeepDiveSession }>(
    "/api/deep-dives",
    { method: "POST", body: payload },
  );
  deepDivesCache = [deepDive, ...deepDivesCache.filter((d) => d.id !== deepDive.id)];
  dispatch(DEEP_DIVES_UPDATED_EVENT);
  return deepDive;
}

/* ── Discover queries + recommendations ──────────────────────── */

export function getDiscoverQueriesSnapshot(): DiscoverQuery[] {
  return discoverQueriesCache;
}

export function getRecommendationsSnapshot(): Recommendation[] {
  return recommendationsCache;
}

export async function refreshDiscover(): Promise<void> {
  const data = await apiFetch<{
    queries: DiscoverQuery[];
    recommendations: Recommendation[];
  }>("/api/discover-queries");
  discoverQueriesCache = data.queries;
  recommendationsCache = data.recommendations;
  dispatch(DISCOVER_UPDATED_EVENT);
}

export async function createDiscoverQuery(query: string): Promise<DiscoverQuery> {
  const { query: created } = await apiFetch<{ query: DiscoverQuery }>(
    "/api/discover-queries",
    { method: "POST", body: { query } },
  );
  discoverQueriesCache = [created, ...discoverQueriesCache];
  dispatch(DISCOVER_UPDATED_EVENT);
  return created;
}

export interface FinalizePayload {
  status: "complete" | "errored";
  /** Structured picks from the `submit_picks` tool call. */
  picks?: Array<{
    url: string;
    title: string;
    rationale: string;
    arxivId?: string;
  }>;
  /** Optional auxiliary text (Plan + Verify line + agent's closing line). */
  notes?: string | null;
  /** Final assistant text for parser fallback when picks aren't structured. */
  text?: string;
}

export async function finalizeDiscoverQuery(
  queryId: string,
  payload: FinalizePayload,
): Promise<{ query: DiscoverQuery; recommendations: Recommendation[] }> {
  const result = await apiFetch<{
    query: DiscoverQuery;
    recommendations: Recommendation[];
  }>(`/api/discover-queries/${encodeURIComponent(queryId)}`, {
    method: "POST",
    body: payload,
  });
  discoverQueriesCache = discoverQueriesCache.map((q) =>
    q.id === result.query.id ? result.query : q,
  );
  recommendationsCache = [...result.recommendations, ...recommendationsCache];
  dispatch(DISCOVER_UPDATED_EVENT);
  return result;
}

export async function setRecommendationDismissed(
  recId: string,
  dismissed: boolean,
): Promise<Recommendation> {
  const { recommendation } = await apiFetch<{ recommendation: Recommendation }>(
    `/api/recommendations/${encodeURIComponent(recId)}`,
    { method: "PATCH", body: { dismissed } },
  );
  recommendationsCache = recommendationsCache.map((r) =>
    r.id === recommendation.id ? recommendation : r,
  );
  dispatch(DISCOVER_UPDATED_EVENT);
  return recommendation;
}

export async function openRecommendation(
  recId: string,
): Promise<{ review: PaperReview; alreadyInLibrary: boolean }> {
  const result = await apiFetch<{ review: PaperReview; alreadyInLibrary: boolean }>(
    `/api/recommendations/${encodeURIComponent(recId)}/open`,
    { method: "POST" },
  );
  // Refresh reviews snapshot so the new (or returned) review shows up in
  // the rest of the app immediately. Discover cache doesn't change here —
  // the rec itself is unchanged; the link is on Review.fromRecommendationId.
  await refreshReviews();
  return result;
}

export async function deleteDiscoverQuery(queryId: string): Promise<void> {
  await apiFetch(`/api/discover-queries/${encodeURIComponent(queryId)}`, {
    method: "DELETE",
  });
  discoverQueriesCache = discoverQueriesCache.filter((q) => q.id !== queryId);
  recommendationsCache = recommendationsCache.filter(
    (r) => r.queryId !== queryId,
  );
  dispatch(DISCOVER_UPDATED_EVENT);
}

/* ── Wiki (ambient knowledge base) ──────────────────────────────── */

let wikiPagesCache: WikiPage[] | null = null;
let wikiPagesInflight: Promise<WikiPage[]> | null = null;
// Generation counter — bumped by `invalidateWikiCache()` so an in-flight
// load started before the invalidation doesn't overwrite the fresh
// cache with stale data when it eventually resolves.
let wikiCacheGeneration = 0;
const wikiIngestedCache = new Map<string, boolean>();

function notifyWikiUpdated(): void {
  dispatch(WIKI_UPDATED_EVENT);
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

export function getWikiCacheSnapshot(): WikiPage[] | null {
  return wikiPagesCache;
}

export async function loadWikiPages(): Promise<WikiPage[]> {
  if (wikiPagesCache) return wikiPagesCache;
  if (wikiPagesInflight) return wikiPagesInflight;
  const gen = wikiCacheGeneration;
  wikiPagesInflight = (async () => {
    try {
      const { pages } = await apiFetch<{ pages: WikiPage[] }>("/api/wiki/pages");
      if (gen !== wikiCacheGeneration) return pages;
      wikiPagesCache = pages;
      notifyWikiUpdated();
      return pages;
    } finally {
      if (gen === wikiCacheGeneration) wikiPagesInflight = null;
    }
  })();
  return wikiPagesInflight;
}

export async function loadWikiPage(slug: string): Promise<WikiPage | null> {
  if (!slug?.trim()) return null;
  if (wikiPagesCache) {
    const hit = wikiPagesCache.find((p) => p.slug === slug);
    if (hit) return hit;
  }
  const { page } = await apiFetch<{ page: WikiPage | null }>(
    `/api/wiki/pages/${encodeURIComponent(slug)}`,
  );
  if (page) upsertWikiPageInCache(page);
  return page;
}

export interface SaveWikiPageInput {
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
  /** Optional: link this page to a review/paper as a source. */
  reviewId?: string;
}

export async function saveWikiPage(input: SaveWikiPageInput): Promise<WikiPage> {
  const { page } = await apiFetch<{ page: WikiPage }>(
    `/api/wiki/pages/${encodeURIComponent(input.slug)}`,
    {
      method: "PUT",
      body: {
        title: input.title,
        content: input.content,
        pageType: input.pageType,
        reviewId: input.reviewId,
      },
    },
  );
  if (input.reviewId) wikiIngestedCache.set(input.reviewId, true);
  upsertWikiPageInCache(page);
  notifyWikiUpdated();
  return page;
}

export async function updateWikiPage(
  slug: string,
  patch: { title?: string; content?: string; pageType?: WikiPageType },
): Promise<WikiPage> {
  const existing = await loadWikiPage(slug);
  if (!existing) throw new Error(`updateWikiPage: page not found: ${slug}`);
  return saveWikiPage({
    slug,
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    pageType: patch.pageType ?? existing.pageType,
  });
}

export async function deleteWikiPage(slug: string): Promise<void> {
  await apiFetch(`/api/wiki/pages/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  if (wikiPagesCache) {
    wikiPagesCache = wikiPagesCache.filter((p) => p.slug !== slug);
  }
  notifyWikiUpdated();
}

export async function checkWikiIngested(reviewId: string): Promise<boolean> {
  if (!reviewId?.trim()) return false;
  const cached = wikiIngestedCache.get(reviewId);
  if (cached !== undefined) return cached;
  const { ingested } = await apiFetch<{ ingested: boolean }>(
    `/api/wiki/ingested?reviewId=${encodeURIComponent(reviewId)}`,
  );
  wikiIngestedCache.set(reviewId, ingested);
  return ingested;
}

export function invalidateWikiCache(): void {
  wikiCacheGeneration++;
  wikiPagesCache = null;
  wikiPagesInflight = null;
  notifyWikiUpdated();
}

export interface WikiFinalizePage {
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
  source?: { reviewId: string; passage?: string };
}

export interface WikiFinalizeInput {
  pages: WikiFinalizePage[];
}

export async function finalizeWikiIngest(
  input: WikiFinalizeInput,
): Promise<{ savedSlugs: string[] }> {
  const res = await apiFetch<{ savedSlugs: string[] }>("/api/wiki/ingest", {
    method: "POST",
    body: input,
  });
  invalidateWikiCache();
  for (const page of input.pages) {
    if (page.source?.reviewId) wikiIngestedCache.set(page.source.reviewId, true);
  }
  return res;
}

export interface WikiBacklink {
  sourceSlug: string;
  sourceTitle: string;
  sourcePageType: WikiPageType;
}

export interface WikiPageSource {
  reviewId: string;
  reviewTitle: string | null;
  reviewArxivId: string | null;
  passage: string | null;
  addedAt: string | null;
}

export interface WikiRevisionSummary {
  id: string;
  savedAt: string;
  contentLength: number;
}

export interface WikiPageMetadata {
  backlinks: WikiBacklink[];
  sources: WikiPageSource[];
  revisions: WikiRevisionSummary[];
}

export async function loadWikiPageMetadata(
  slug: string,
): Promise<WikiPageMetadata> {
  return apiFetch<WikiPageMetadata>(
    `/api/wiki/pages/${encodeURIComponent(slug)}/metadata`,
  );
}

export interface WikiRevision {
  id: string;
  slug: string;
  title: string;
  content: string;
  savedAt: string;
}

export async function loadWikiRevision(id: string): Promise<WikiRevision | null> {
  const { revision } = await apiFetch<{ revision: WikiRevision | null }>(
    `/api/wiki/revisions/${id}`,
  );
  return revision;
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

/**
 * True when the server has a platform-key fallback for this built-in
 * provider. Booleans only — sourced from /api/bootstrap; the env key is
 * never sent to the browser.
 */
export function hasPlatformFallback(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return platformProvidersCache[provider] === true;
}

export function isBuiltinProviderReady(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return !!getApiKey(provider) || hasPlatformFallback(provider);
}

export function isModelReady(model: Model): boolean {
  if (isInferenceProviderType(model.provider)) {
    if (!model.profileId) return false;
    const p = getInferenceProfile(model.profileId);
    if (!p?.label?.trim()) return false;
    return hasInferenceCredentials(p);
  }
  return isBuiltinProviderReady(model.provider);
}

/** @deprecated prefer isBuiltinProviderReady or isModelReady */
export function isProviderReady(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return isBuiltinProviderReady(provider);
}

/**
 * Literal: the user has saved at least one of their own credentials
 * (built-in key or inference profile). Does NOT consider platform
 * fallbacks — used by Settings copy that must reflect what the user
 * actually configured.
 */
export function hasAnySavedApiKey(): boolean {
  for (const p of BUILTIN_PROVIDER_ORDER) {
    if (getApiKey(p)) return true;
  }
  return settingsCache.inferenceProfiles.some(hasInferenceCredentials);
}

/**
 * True when the user can actually run a model — their own key, an
 * inference profile, OR a platform fallback. This is the gate the chat /
 * discover / model-picker UI should use, so a fresh user with no key can
 * still work out of the box when a fallback is configured.
 */
export function hasUsableProvider(): boolean {
  if (hasAnySavedApiKey()) return true;
  for (const p of BUILTIN_PROVIDER_ORDER) {
    if (hasPlatformFallback(p)) return true;
  }
  return false;
}

interface SettingsPatchBody {
  keys?: Partial<Record<Provider, string | null>>;
  inferenceProfiles?: InferenceProviderProfile[] | null;
  selectedModel?: Model | null;
  braveSearchApiKey?: string | null;
}

async function patchSettings(patch: SettingsPatchBody): Promise<void> {
  const { settings, platformProviders } = await apiFetch<{
    settings: SettingsCache;
    platformProviders?: Partial<Record<Provider, boolean>>;
  }>("/api/settings", { method: "PATCH", body: patch });
  settingsCache = settings;
  if (platformProviders) platformProvidersCache = platformProviders;
  dispatch(KEYS_UPDATED_EVENT);
}

export async function setApiKey(provider: Provider, key: string): Promise<void> {
  await patchSettings({ keys: { [provider]: key } });
}

export async function saveInferenceProfiles(
  profiles: InferenceProviderProfile[],
): Promise<void> {
  await patchSettings({ inferenceProfiles: profiles });
}

export async function clearApiKey(provider: Provider): Promise<void> {
  await patchSettings({ keys: { [provider]: null } });
}

/* ── Tool keys (currently just Brave Search) ── */

export function getBraveSearchApiKey(): string | null {
  return settingsCache.braveSearchApiKey;
}

export function hasBraveSearchApiKey(): boolean {
  return !!settingsCache.braveSearchApiKey;
}

export async function setBraveSearchApiKey(key: string): Promise<void> {
  await patchSettings({ braveSearchApiKey: key });
}

export async function clearBraveSearchApiKey(): Promise<void> {
  await patchSettings({ braveSearchApiKey: null });
}

export async function saveSelectedModel(model: Model | null): Promise<void> {
  await patchSettings({ selectedModel: model });
}

export function getSavedSelectedModel(): Model | null {
  const m = settingsCache.selectedModel;
  if (m && isModelReady(m)) return m;
  // Nothing usable saved (fresh user, or their provider's key was
  // removed). When a provider is ready — own key OR platform fallback —
  // default to the first built-in model so a new user can start chatting
  // without first opening the model picker.
  return FALLBACK_MODELS.find((fm) => isModelReady(fm)) ?? null;
}

export async function refreshSettingsFromServer(): Promise<void> {
  const { settings, platformProviders } = await apiFetch<{
    settings: SettingsCache;
    platformProviders?: Partial<Record<Provider, boolean>>;
  }>("/api/settings");
  settingsCache = settings;
  if (platformProviders) platformProvidersCache = platformProviders;
  dispatch(KEYS_UPDATED_EVENT);
}
