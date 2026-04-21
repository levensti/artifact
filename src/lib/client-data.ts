/**
 * Client-side data layer. All reads and writes go to the Dexie-backed
 * store in src/lib/client/store.ts. This module preserves the public
 * API the rest of the app already depends on — every exported function
 * matches its pre-migration signature, so callers remain untouched.
 *
 * In-memory caches sit in front of Dexie so that UI render paths can
 * call `getReviewsSnapshot()` / `getWikiCacheSnapshot()` synchronously,
 * the same way they did when the data lived on the server.
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
import type { PrerequisitesData } from "@/lib/explore";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import { normalizeArxivId } from "@/lib/reviews";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
  EXPLORE_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
  WIKI_UPDATED_EVENT,
} from "@/lib/storage-events";
import * as store from "@/lib/client/store";

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

const messagesCache = new Map<string, ChatMessage[]>();
const annotationsCache = new Map<string, Annotation[]>();
const exploreCache = new Map<
  string,
  { prerequisites: PrerequisitesData | null }
>();

function dispatch(name: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export async function hydrateClientStore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const boot = await store.getBootstrap();
    reviewsCache = boot.reviews;
    settingsCache = boot.settings;
    deepDivesCache = boot.deepDives;
    messagesCache.clear();
    annotationsCache.clear();
    exploreCache.clear();
    dispatch(REVIEWS_UPDATED_EVENT);
    dispatch(KEYS_UPDATED_EVENT);
    dispatch(EXPLORE_UPDATED_EVENT);
    dispatch(DEEP_DIVES_UPDATED_EVENT);
  })();
  return hydratePromise;
}

/* ── Reviews ── */

export function getReviewsSnapshot(): PaperReview[] {
  return reviewsCache;
}

export async function refreshReviews(): Promise<void> {
  reviewsCache = await store.listReviews();
  dispatch(REVIEWS_UPDATED_EVENT);
}

export function getReview(id: string): PaperReview | undefined {
  return reviewsCache.find((r) => r.id === id);
}

export async function createReview(
  arxivId: string,
  title: string,
): Promise<PaperReview> {
  const canonical = normalizeArxivId(arxivId);
  const existing = await store.getReviewByArxivId(canonical);
  if (existing) {
    await refreshReviews();
    return existing;
  }
  const now = new Date().toISOString();
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title: title || `arXiv:${canonical}`,
    arxivId: canonical,
    createdAt: now,
    updatedAt: now,
    pdfPath: null,
    sourceUrl: null,
  };
  await store.insertReview(review);
  await refreshReviews();
  return review;
}

export async function createLocalPdfReview(
  pdfPath: string,
  title: string,
): Promise<PaperReview> {
  const now = new Date().toISOString();
  const fallback = pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") || "Local PDF";
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title: title || fallback,
    arxivId: null,
    createdAt: now,
    updatedAt: now,
    pdfPath,
    sourceUrl: null,
  };
  await store.insertReview(review);
  await refreshReviews();
  return review;
}

export async function createWebReview(
  sourceUrl: string,
  title: string,
): Promise<PaperReview> {
  const now = new Date().toISOString();
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title: title || sourceUrl,
    arxivId: null,
    createdAt: now,
    updatedAt: now,
    pdfPath: null,
    sourceUrl,
  };
  await store.insertReview(review);
  await refreshReviews();
  return review;
}

export async function deleteReview(id: string): Promise<void> {
  await store.deleteReview(id);
  messagesCache.delete(id);
  annotationsCache.delete(id);
  exploreCache.delete(id);
  await refreshReviews();
}

/* ── Messages ── */

export async function loadMessages(reviewId: string): Promise<ChatMessage[]> {
  if (!reviewId?.trim()) return [];
  const cached = messagesCache.get(reviewId);
  if (cached) return cached;
  const list = await store.getMessages(reviewId);
  messagesCache.set(reviewId, list);
  return list;
}

export async function saveMessages(
  reviewId: string,
  messages: ChatMessage[],
): Promise<void> {
  messagesCache.set(reviewId, messages);
  await store.setMessages(reviewId, messages);
}

/* ── Annotations ── */

export async function loadAnnotations(reviewId: string): Promise<Annotation[]> {
  if (!reviewId?.trim()) return [];
  const cached = annotationsCache.get(reviewId);
  if (cached) return cached;
  const list = await store.getAnnotations(reviewId);
  annotationsCache.set(reviewId, list);
  return list;
}

export async function saveAnnotations(
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  annotationsCache.set(reviewId, annotations);
  await store.setAnnotations(reviewId, annotations);
  dispatch(ANNOTATIONS_UPDATED_EVENT);
}

/* ── Deep dives ── */

export function getDeepDivesSnapshot(): DeepDiveSession[] {
  return deepDivesCache;
}

export async function refreshDeepDives(): Promise<void> {
  deepDivesCache = await store.listDeepDives();
  dispatch(DEEP_DIVES_UPDATED_EVENT);
}

export async function saveDeepDive(
  payload: Omit<DeepDiveSession, "id" | "createdAt">,
): Promise<DeepDiveSession> {
  const session: DeepDiveSession = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await store.insertDeepDive(session);
  deepDivesCache = [session, ...deepDivesCache.filter((d) => d.id !== session.id)];
  dispatch(DEEP_DIVES_UPDATED_EVENT);
  return session;
}

/* ── Explore ── */

export async function loadExplore(
  reviewId: string,
): Promise<{
  prerequisites: PrerequisitesData | null;
}> {
  if (!reviewId?.trim()) {
    return { prerequisites: null };
  }
  const cached = exploreCache.get(reviewId);
  if (cached) return cached;
  const prerequisites = await store.getPrerequisites(reviewId);
  const data = { prerequisites };
  exploreCache.set(reviewId, data);
  return data;
}

export function getExploreCached(reviewId: string): {
  prerequisites: PrerequisitesData | null;
} | undefined {
  return exploreCache.get(reviewId);
}

export async function savePrerequisites(
  reviewId: string,
  prerequisites: PrerequisitesData,
): Promise<void> {
  exploreCache.set(reviewId, { prerequisites });
  await store.setPrerequisites(reviewId, prerequisites);
  dispatch(EXPLORE_UPDATED_EVENT);
}

/**
 * Invalidate the client-side explore cache for a review so the next
 * read re-fetches from Dexie.
 */
export function invalidateExploreCache(reviewId: string): void {
  exploreCache.delete(reviewId);
  dispatch(EXPLORE_UPDATED_EVENT);
}

export async function clearExploreData(reviewId: string): Promise<void> {
  exploreCache.delete(reviewId);
  await store.clearExploreData(reviewId);
  dispatch(EXPLORE_UPDATED_EVENT);
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

/** Synchronous snapshot for useSyncExternalStore. null until first load. */
export function getWikiCacheSnapshot(): WikiPage[] | null {
  return wikiPagesCache;
}

/** Fetch all wiki pages (cached). Safe to call repeatedly. */
export async function loadWikiPages(): Promise<WikiPage[]> {
  if (wikiPagesCache) return wikiPagesCache;
  if (wikiPagesInflight) return wikiPagesInflight;
  const gen = wikiCacheGeneration;
  wikiPagesInflight = (async () => {
    try {
      const list = await store.listWikiPages();
      if (gen !== wikiCacheGeneration) return list;
      wikiPagesCache = list;
      notifyWikiUpdated();
      return list;
    } finally {
      if (gen === wikiCacheGeneration) wikiPagesInflight = null;
    }
  })();
  return wikiPagesInflight;
}

/** Fetch a single wiki page by slug, or null if it doesn't exist. */
export async function loadWikiPage(slug: string): Promise<WikiPage | null> {
  if (!slug?.trim()) return null;
  if (wikiPagesCache) {
    const hit = wikiPagesCache.find((p) => p.slug === slug);
    if (hit) return hit;
  }
  const page = await store.getWikiPageBySlug(slug);
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

/** Create or upsert a wiki page. Always dispatches WIKI_UPDATED_EVENT. */
export async function saveWikiPage(
  input: SaveWikiPageInput,
): Promise<WikiPage> {
  const existing = await store.getWikiPageBySlug(input.slug);
  const id = existing?.id ?? crypto.randomUUID();
  await store.upsertWikiPage({
    id,
    slug: input.slug,
    title: input.title,
    content: input.content,
    pageType: input.pageType,
  });
  if (input.reviewId) {
    await store.addWikiPageSource(id, input.reviewId);
    wikiIngestedCache.set(input.reviewId, true);
  }
  const saved = await store.getWikiPageBySlug(input.slug);
  if (!saved) throw new Error(`saveWikiPage: page disappeared after upsert: ${input.slug}`);
  upsertWikiPageInCache(saved);
  notifyWikiUpdated();
  return saved;
}

/** Partial update of an existing wiki page. */
export async function updateWikiPage(
  slug: string,
  patch: { title?: string; content?: string; pageType?: WikiPageType },
): Promise<WikiPage> {
  const existing = await store.getWikiPageBySlug(slug);
  if (!existing) throw new Error(`updateWikiPage: page not found: ${slug}`);
  await store.upsertWikiPage({
    id: existing.id,
    slug,
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    pageType: patch.pageType ?? existing.pageType,
  });
  const saved = await store.getWikiPageBySlug(slug);
  if (!saved) throw new Error(`updateWikiPage: page disappeared: ${slug}`);
  upsertWikiPageInCache(saved);
  notifyWikiUpdated();
  return saved;
}

/** Delete a wiki page by slug. */
export async function deleteWikiPage(slug: string): Promise<void> {
  const existing = await store.getWikiPageBySlug(slug);
  if (!existing) return;
  await store.deleteWikiPage(existing.id);
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
  const ingested = await store.hasWikiSourcesForReview(reviewId);
  wikiIngestedCache.set(reviewId, ingested);
  return ingested;
}

/**
 * Clear local wiki cache and notify subscribers. Used by ingest
 * pipelines after they finish writing so readers re-fetch fresh data.
 */
export function invalidateWikiCache(): void {
  wikiCacheGeneration++;
  wikiPagesCache = null;
  wikiPagesInflight = null;
  notifyWikiUpdated();
}

/* ── Wiki finalize / enriched metadata helpers ─────────────────── */

export interface WikiFinalizePage {
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
  source?: { reviewId: string; passage?: string };
}

export interface WikiFinalizeInput {
  pages: WikiFinalizePage[];
  logEntry?: { label: string; kind?: string };
}

/**
 * Atomically finalize a journal-write batch inside a single Dexie
 * transaction. Fires WIKI_UPDATED_EVENT on success.
 */
export async function finalizeWikiIngest(
  input: WikiFinalizeInput,
): Promise<{ savedSlugs: string[] }> {
  const res = await store.wikiIngestFinalize(input);
  wikiCacheGeneration++;
  wikiPagesCache = null;
  wikiPagesInflight = null;
  for (const page of input.pages) {
    if (page.source?.reviewId) {
      wikiIngestedCache.set(page.source.reviewId, true);
    }
  }
  notifyWikiUpdated();
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
  id: number;
  savedAt: string;
  contentLength: number;
}

export interface WikiPageMetadata {
  backlinks: WikiBacklink[];
  sources: WikiPageSource[];
  revisions: WikiRevisionSummary[];
}

/** Fetch backlinks, sources, and revisions for a page. */
export async function loadWikiPageMetadata(
  slug: string,
): Promise<WikiPageMetadata> {
  const [backlinks, sources, revisions] = await Promise.all([
    store.getWikiBacklinks(slug),
    store.getWikiPageSources(slug),
    store.listWikiRevisions(slug),
  ]);
  return { backlinks, sources, revisions };
}

export interface WikiRevision {
  id: number;
  slug: string;
  title: string;
  content: string;
  savedAt: string;
}

/** Fetch a single historical revision by id. */
export async function loadWikiRevision(id: number): Promise<WikiRevision | null> {
  return store.getWikiRevision(id);
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

async function reloadSettingsCache(): Promise<void> {
  settingsCache = await store.getSettings();
  dispatch(KEYS_UPDATED_EVENT);
}

export async function setApiKey(provider: Provider, key: string): Promise<void> {
  await store.patchSettings({ keys: { [provider]: key } });
  await reloadSettingsCache();
}

export async function saveInferenceProfiles(
  profiles: InferenceProviderProfile[],
): Promise<void> {
  await store.patchSettings({ inferenceProfiles: profiles });
  await reloadSettingsCache();
}

export async function clearApiKey(provider: Provider): Promise<void> {
  await store.patchSettings({ keys: { [provider]: null } });
  await reloadSettingsCache();
}

export async function saveSelectedModel(model: Model | null): Promise<void> {
  await store.patchSettings({ selectedModel: model });
  await reloadSettingsCache();
}

export function getSavedSelectedModel(): Model | null {
  const m = settingsCache.selectedModel;
  if (!m) return null;
  return isModelReady(m) ? m : null;
}

export async function refreshSettingsFromServer(): Promise<void> {
  await reloadSettingsCache();
}
