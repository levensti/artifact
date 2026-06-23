/**
 * Client-side data layer. All reads and writes go through the app's API
 * routes (see src/app/api/*) which back onto Postgres via Prisma.
 *
 * In-memory caches sit in front of the network so that UI render paths
 * can call `getReviewsSnapshot()` / `getWikiCacheSnapshot()` synchronously,
 * the same way they did when the data lived in IndexedDB.
 */

import type {
  PaperReview,
  ChatMessage,
  CompactionRecord,
  ContextUsage,
} from "@/lib/review-types";
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
  /** User's optional OpenRouter key override (server falls back to env). */
  openRouterKey: string | null;
  exaApiKey: string | null;
}

const EMPTY_SETTINGS: SettingsCache = {
  openRouterKey: null,
  exaApiKey: null,
};

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Whether the server has a platform OpenRouter key in env. Boolean only —
 * the key never reaches the browser. Lets the UI treat the app as usable
 * even when the user hasn't entered their own key.
 */
let platformOpenRouterCache = false;

/**
 * Tool-key counterpart to `platformProvidersCache`. Booleans only — the
 * env key never reaches the browser. Lets the UI suppress the "add an
 * Exa key" prompt when the server already has one in env.
 */
interface PlatformToolsCache {
  exa?: boolean;
}
let platformToolsCache: PlatformToolsCache = {};

let hydratePromise: Promise<void> | null = null;
/**
 * Whether settings (API keys) have been loaded at least once. Until then the
 * key state is genuinely unknown — UI should render a neutral state rather
 * than assuming "no keys", which causes a "set up your keys" flash on load.
 */
let settingsHydrated = false;
let reviewsCache: PaperReview[] = [];
/**
 * Whether the reviews list has been loaded at least once. Until then an empty
 * `reviewsCache` is "unknown", not "no reviews" — the sidebar uses this to show
 * a loading state instead of flashing the "Your reviews will appear here"
 * empty state on every refresh. Mirrors {@link settingsHydrated}.
 */
let reviewsHydrated = false;
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
    // Discover data is deliberately excluded — it's lazy-loaded by the
    // /discover route via ensureDiscoverLoaded() so it never bloats the
    // app-wide bootstrap that every page pays for.
    const boot = await apiFetch<{
      reviews: PaperReview[];
      settings: SettingsCache;
      platformOpenRouter?: boolean;
      platformTools?: PlatformToolsCache;
      deepDives: DeepDiveSession[];
      user: CurrentUser | null;
    }>("/api/bootstrap");
    reviewsCache = boot.reviews;
    reviewsHydrated = true;
    settingsCache = boot.settings;
    settingsHydrated = true;
    platformOpenRouterCache = boot.platformOpenRouter ?? false;
    platformToolsCache = boot.platformTools ?? {};
    deepDivesCache = boot.deepDives;
    currentUser = boot.user;
    messagesCache.clear();
    annotationsCache.clear();
    dispatch(REVIEWS_UPDATED_EVENT);
    dispatch(KEYS_UPDATED_EVENT);
    dispatch(DEEP_DIVES_UPDATED_EVENT);
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
  reviewsHydrated = true;
  dispatch(REVIEWS_UPDATED_EVENT);
}

/** Whether the reviews list has been loaded at least once. */
export function areReviewsHydrated(): boolean {
  return reviewsHydrated;
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

/**
 * Patch a review's title. Optimistically updates the in-memory cache so the
 * library list and the open review header pick it up immediately; the
 * server returns the canonical row and we replace once more on resolve.
 */
export async function updateReviewTitle(
  id: string,
  title: string,
): Promise<PaperReview | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const existing = reviewsCache.find((r) => r.id === id);
  if (existing && existing.title === trimmed) return existing;
  if (existing) {
    reviewsCache = reviewsCache.map((r) =>
      r.id === id ? { ...r, title: trimmed } : r,
    );
    dispatch(REVIEWS_UPDATED_EVENT);
  }
  const { review } = await apiFetch<{ review: PaperReview }>(
    `/api/reviews/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { title: trimmed } },
  );
  reviewsCache = reviewsCache.map((r) => (r.id === id ? review : r));
  dispatch(REVIEWS_UPDATED_EVENT);
  return review;
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

/**
 * Load messages plus the conversation's derived `contextUsage` (measured size +
 * window + compaction verdict) in one request. Used by the chat hook on mount
 * so the usage meter is seeded from server-authoritative state — surviving a
 * page refresh. Always hits the network (the meter must be fresh) while priming
 * the messages cache.
 */
export async function loadConversation(reviewId: string): Promise<{
  messages: ChatMessage[];
  contextUsage: ContextUsage | null;
}> {
  if (!reviewId?.trim()) return { messages: [], contextUsage: null };
  const res = await apiFetch<{
    messages: ChatMessage[];
    contextUsage: ContextUsage | null;
  }>(`/api/reviews/${encodeURIComponent(reviewId)}/messages`);
  messagesCache.set(reviewId, res.messages);
  return { messages: res.messages, contextUsage: res.contextUsage ?? null };
}

/**
 * Compact older turns of a conversation into a recap (server-side, metered,
 * idempotent). Returns the new compaction record and an estimated post-compaction
 * usage view for the meter. The raw messages are unchanged, so the cache stays
 * valid.
 */
export async function compactConversation(
  reviewId: string,
  apiKey?: string,
): Promise<{
  status: "compacted" | "already" | "noop";
  compaction: CompactionRecord | null;
  contextUsage: ContextUsage | null;
}> {
  return apiFetch(`/api/chat/compact`, {
    method: "POST",
    body: { reviewId, apiKey },
  });
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

/**
 * Update the in-memory messages cache WITHOUT a network write. Used by the
 * main chat flow, where the server now persists each turn authoritatively —
 * the client only needs its cache kept in sync so a remount in the same
 * session doesn't read a stale snapshot. Distinct from `saveMessages`, which
 * is for client-initiated writes (e.g. clearing the conversation).
 */
export function primeMessagesCache(
  reviewId: string,
  messages: ChatMessage[],
): void {
  if (!reviewId?.trim()) return;
  messagesCache.set(reviewId, messages);
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

let discoverHydrated = false;
let discoverInflight: Promise<void> | null = null;

/**
 * Lazy, deduped discover load. The /discover route calls this on mount so the
 * discover queries + recommendations stay out of the app-wide bootstrap that
 * every page (the overview, a review, the journal) pays for.
 */
export async function ensureDiscoverLoaded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (discoverHydrated) return;
  if (discoverInflight) return discoverInflight;
  discoverInflight = (async () => {
    try {
      await refreshDiscover();
      discoverHydrated = true;
    } finally {
      discoverInflight = null;
    }
  })();
  return discoverInflight;
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
    authors?: string | null;
    publishedDate?: string | null;
    publishedYear?: number | null;
    venue?: string | null;
    citationCount?: number | null;
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

/**
 * Whether settings have loaded at least once. Before this is true the key
 * state is unknown, not "no keys" — callers use it to avoid a setup-prompt
 * flash during the initial bootstrap.
 */
export function isSettingsHydrated(): boolean {
  return settingsHydrated;
}

/** The user's saved OpenRouter key override, if any. */
export function getOpenRouterKey(): string | null {
  return settingsCache.openRouterKey;
}

/**
 * True when the server has a platform OpenRouter key in env. Boolean only —
 * sourced from /api/bootstrap; the env key is never sent to the browser.
 */
export function hasPlatformOpenRouterKey(): boolean {
  return platformOpenRouterCache;
}

/** True when the server has EXA_API_KEY set in env. Booleans only. */
export function hasPlatformExaKey(): boolean {
  return platformToolsCache.exa === true;
}

/** Literal: the user has saved their own OpenRouter key. */
export function hasAnySavedApiKey(): boolean {
  return !!settingsCache.openRouterKey;
}

/**
 * True when the app can run — the user has their own OpenRouter key OR the
 * server has a platform key. The gate the chat / discover UI uses, so a
 * fresh user can work out of the box when a platform key is configured.
 */
export function hasUsableProvider(): boolean {
  return hasAnySavedApiKey() || hasPlatformOpenRouterKey();
}

interface SettingsPatchBody {
  openRouterKey?: string | null;
  exaApiKey?: string | null;
}

async function patchSettings(patch: SettingsPatchBody): Promise<void> {
  const { settings, platformOpenRouter, platformTools } = await apiFetch<{
    settings: SettingsCache;
    platformOpenRouter?: boolean;
    platformTools?: PlatformToolsCache;
  }>("/api/settings", { method: "PATCH", body: patch });
  settingsCache = settings;
  settingsHydrated = true;
  if (platformOpenRouter !== undefined) platformOpenRouterCache = platformOpenRouter;
  if (platformTools) platformToolsCache = platformTools;
  dispatch(KEYS_UPDATED_EVENT);
}

export async function setOpenRouterKey(key: string): Promise<void> {
  await patchSettings({ openRouterKey: key });
}

export async function clearOpenRouterKey(): Promise<void> {
  await patchSettings({ openRouterKey: null });
}

/* ── Tool keys (currently just Exa Search) ── */

export function getExaApiKey(): string | null {
  return settingsCache.exaApiKey;
}

export function hasExaApiKey(): boolean {
  return !!settingsCache.exaApiKey;
}

export async function setExaApiKey(key: string): Promise<void> {
  await patchSettings({ exaApiKey: key });
}

export async function clearExaApiKey(): Promise<void> {
  await patchSettings({ exaApiKey: null });
}

export async function refreshSettingsFromServer(): Promise<void> {
  const { settings, platformOpenRouter, platformTools } = await apiFetch<{
    settings: SettingsCache;
    platformOpenRouter?: boolean;
    platformTools?: PlatformToolsCache;
  }>("/api/settings");
  settingsCache = settings;
  settingsHydrated = true;
  if (platformOpenRouter !== undefined) platformOpenRouterCache = platformOpenRouter;
  if (platformTools) platformToolsCache = platformTools;
  dispatch(KEYS_UPDATED_EVENT);
}
