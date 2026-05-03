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
  isInferenceProviderType,
} from "@/lib/models";
import { hasInferenceCredentials } from "@/lib/ai-providers";
import type { PaperReview, ChatMessage } from "@/lib/review-types";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { PrerequisitesData } from "@/lib/explore";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import {
  REVIEWS_UPDATED_EVENT,
  ANNOTATIONS_UPDATED_EVENT,
  DEEP_DIVES_UPDATED_EVENT,
  EXPLORE_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
  WIKI_UPDATED_EVENT,
  USER_UPDATED_EVENT,
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

let hydratePromise: Promise<void> | null = null;
let reviewsCache: PaperReview[] = [];
let settingsCache: SettingsCache = EMPTY_SETTINGS;
let deepDivesCache: DeepDiveSession[] = [];
let currentUser: CurrentUser | null = null;

const messagesCache = new Map<string, ChatMessage[]>();
const annotationsCache = new Map<string, Annotation[]>();
const exploreCache = new Map<string, { prerequisites: PrerequisitesData | null }>();

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
      deepDives: DeepDiveSession[];
      user: CurrentUser | null;
    }>("/api/bootstrap");
    reviewsCache = boot.reviews;
    settingsCache = boot.settings;
    deepDivesCache = boot.deepDives;
    currentUser = boot.user;
    messagesCache.clear();
    annotationsCache.clear();
    exploreCache.clear();
    dispatch(REVIEWS_UPDATED_EVENT);
    dispatch(KEYS_UPDATED_EVENT);
    dispatch(EXPLORE_UPDATED_EVENT);
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
  exploreCache.delete(id);
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

/* ── Explore (prerequisites) ── */

export async function loadExplore(
  reviewId: string,
): Promise<{ prerequisites: PrerequisitesData | null }> {
  if (!reviewId?.trim()) return { prerequisites: null };
  const cached = exploreCache.get(reviewId);
  if (cached) return cached;
  const { prerequisites } = await apiFetch<{
    prerequisites: PrerequisitesData | null;
  }>(`/api/reviews/${encodeURIComponent(reviewId)}/prerequisites`);
  const data = { prerequisites };
  exploreCache.set(reviewId, data);
  return data;
}

export async function savePrerequisites(
  reviewId: string,
  prerequisites: PrerequisitesData,
): Promise<void> {
  exploreCache.set(reviewId, { prerequisites });
  await apiFetch(
    `/api/reviews/${encodeURIComponent(reviewId)}/prerequisites`,
    { method: "PUT", body: { prerequisites } },
  );
  dispatch(EXPLORE_UPDATED_EVENT);
}

export async function clearExploreData(reviewId: string): Promise<void> {
  exploreCache.delete(reviewId);
  await apiFetch(
    `/api/reviews/${encodeURIComponent(reviewId)}/prerequisites`,
    { method: "DELETE" },
  );
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
  id: number;
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
  id: number;
  slug: string;
  title: string;
  content: string;
  savedAt: string;
}

export async function loadWikiRevision(id: number): Promise<WikiRevision | null> {
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

export function isBuiltinProviderReady(provider: Provider): boolean {
  if (isInferenceProviderType(provider)) return false;
  return !!getApiKey(provider);
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

export function hasAnySavedApiKey(): boolean {
  for (const p of BUILTIN_PROVIDER_ORDER) {
    if (getApiKey(p)) return true;
  }
  return settingsCache.inferenceProfiles.some(hasInferenceCredentials);
}

interface SettingsPatchBody {
  keys?: Partial<Record<Provider, string | null>>;
  inferenceProfiles?: InferenceProviderProfile[] | null;
  selectedModel?: Model | null;
  braveSearchApiKey?: string | null;
}

async function patchSettings(patch: SettingsPatchBody): Promise<void> {
  const { settings } = await apiFetch<{ settings: SettingsCache }>(
    "/api/settings",
    { method: "PATCH", body: patch },
  );
  settingsCache = settings;
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
  if (!m) return null;
  return isModelReady(m) ? m : null;
}

export async function refreshSettingsFromServer(): Promise<void> {
  const { settings } = await apiFetch<{ settings: SettingsCache }>(
    "/api/settings",
  );
  settingsCache = settings;
  dispatch(KEYS_UPDATED_EVENT);
}
