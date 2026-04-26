/**
 * Client-side port of the old server/store.ts. All functions mirror the
 * original signatures but read/write IndexedDB via Dexie instead of SQLite.
 *
 * Everything here is async because IndexedDB is async. The call sites in
 * client-data.ts were already awaiting the HTTP round-trip so the
 * transition is transparent.
 */

import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type {
  GlobalGraphData,
  GraphData,
  PrerequisitesData,
} from "@/lib/explore";
import type {
  InferenceProviderProfile,
  Model,
  Provider,
} from "@/lib/models";
import { BUILTIN_PROVIDER_ORDER, isInferenceProviderType } from "@/lib/models";
import type { ChatMessage, PaperReview } from "@/lib/review-types";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import { getDb, type WikiBacklinkRow } from "@/lib/client/db";

const INFERENCE_PROFILES_KEY = "inference_profiles";
const SELECTED_MODEL_KEY = "selected_model";
const API_KEY_PREFIX = "api_key:";
const BRAVE_SEARCH_API_KEY = "brave_search_api_key";

/* ── Reviews ── */

export async function listReviews(): Promise<PaperReview[]> {
  const rows = await getDb().reviews.toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getReview(id: string): Promise<PaperReview | undefined> {
  return getDb().reviews.get(id);
}

export async function getReviewByArxivId(
  arxivId: string,
): Promise<PaperReview | undefined> {
  const target = arxivId.toLowerCase();
  const rows = await getDb().reviews.toArray();
  return rows.find((r) => (r.arxivId ?? "").toLowerCase() === target);
}

export async function insertReview(review: PaperReview): Promise<void> {
  await getDb().reviews.put(review);
}

/** Deletes the review and cascades to messages, annotations, explore rows, and deep_dives. */
export async function deleteReview(id: string): Promise<boolean> {
  const db = getDb();
  return db.transaction(
    "rw",
    [
      db.reviews,
      db.reviewMessages,
      db.reviewAnnotations,
      db.explorePrerequisites,
      db.exploreGraphs,
      db.deepDives,
      db.wikiPageSources,
      db.pdfBlobs,
    ],
    async () => {
      const existing = await db.reviews.get(id);
      if (!existing) return false;
      if (existing.pdfPath) {
        await db.pdfBlobs.delete(existing.pdfPath);
      }
      await db.reviews.delete(id);
      await db.reviewMessages.delete(id);
      await db.reviewAnnotations.delete(id);
      await db.explorePrerequisites.delete(id);
      await db.exploreGraphs.delete(id);
      await db.deepDives.where("reviewId").equals(id).delete();
      await db.wikiPageSources.where("reviewId").equals(id).delete();
      return true;
    },
  );
}

/* ── Messages ── */

export async function getMessages(reviewId: string): Promise<ChatMessage[]> {
  const row = await getDb().reviewMessages.get(reviewId);
  return row?.messages ?? [];
}

export async function setMessages(
  reviewId: string,
  messages: ChatMessage[],
): Promise<void> {
  await getDb().reviewMessages.put({ reviewId, messages });
}

/* ── Annotations ── */

export async function getAnnotations(reviewId: string): Promise<Annotation[]> {
  const row = await getDb().reviewAnnotations.get(reviewId);
  return row?.annotations ?? [];
}

export async function setAnnotations(
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  await getDb().reviewAnnotations.put({ reviewId, annotations });
}

/* ── Deep dives ── */

export async function listDeepDives(): Promise<DeepDiveSession[]> {
  const rows = await getDb().deepDives.toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function insertDeepDive(session: DeepDiveSession): Promise<void> {
  await getDb().deepDives.put(session);
}

/* ── Explore (per review) ── */

export async function getPrerequisites(
  reviewId: string,
): Promise<PrerequisitesData | null> {
  const row = await getDb().explorePrerequisites.get(reviewId);
  return row?.data ?? null;
}

export async function setPrerequisites(
  reviewId: string,
  data: PrerequisitesData,
): Promise<void> {
  await getDb().explorePrerequisites.put({ reviewId, data });
}

export async function getGraphData(
  reviewId: string,
): Promise<GraphData | null> {
  const row = await getDb().exploreGraphs.get(reviewId);
  return row?.graph ?? null;
}

export async function setGraphData(
  reviewId: string,
  graph: GraphData,
): Promise<void> {
  await getDb().exploreGraphs.put({ reviewId, graph });
}

export async function clearExploreData(reviewId: string): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [db.explorePrerequisites, db.exploreGraphs],
    async () => {
      await db.explorePrerequisites.delete(reviewId);
      await db.exploreGraphs.delete(reviewId);
    },
  );
}

/* ── Global graph ── */

export async function getGlobalGraphData(): Promise<GlobalGraphData | null> {
  const row = await getDb().globalGraph.get("singleton");
  return row?.data ?? null;
}

export async function setGlobalGraphData(data: GlobalGraphData): Promise<void> {
  await getDb().globalGraph.put({ id: "singleton", data });
}

export async function clearGlobalKnowledgeGraph(): Promise<void> {
  await getDb().globalGraph.delete("singleton");
}

/* ── Settings (API keys + selected model) ── */

async function parseInferenceProfiles(): Promise<InferenceProviderProfile[]> {
  const row = await getDb().settings.get(INFERENCE_PROFILES_KEY);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? (parsed as InferenceProviderProfile[]) : [];
  } catch {
    return [];
  }
}

export async function getInferenceProfile(
  id: string,
): Promise<InferenceProviderProfile | undefined> {
  return (await parseInferenceProfiles()).find((p) => p.id === id);
}

export async function getSettings(): Promise<{
  keys: Partial<Record<Provider, string>>;
  inferenceProfiles: InferenceProviderProfile[];
  selectedModel: Model | null;
  braveSearchApiKey: string | null;
}> {
  const db = getDb();
  const keys: Partial<Record<Provider, string>> = {};
  for (const p of BUILTIN_PROVIDER_ORDER) {
    const row = await db.settings.get(`${API_KEY_PREFIX}${p}`);
    if (row?.value) keys[p] = row.value;
  }
  const inferenceProfiles = await parseInferenceProfiles();
  const modelRow = await db.settings.get(SELECTED_MODEL_KEY);
  let selectedModel: Model | null = null;
  if (modelRow?.value) {
    try {
      selectedModel = JSON.parse(modelRow.value) as Model;
    } catch {
      selectedModel = null;
    }
  }
  if (selectedModel && isInferenceProviderType(selectedModel.provider)) {
    if (
      !selectedModel.profileId ||
      !inferenceProfiles.some((p) => p.id === selectedModel!.profileId)
    ) {
      selectedModel = null;
    }
  }
  const braveRow = await db.settings.get(BRAVE_SEARCH_API_KEY);
  const braveSearchApiKey = braveRow?.value || null;
  return { keys, inferenceProfiles, selectedModel, braveSearchApiKey };
}

export async function setApiKey(
  provider: Provider,
  key: string,
): Promise<void> {
  await getDb().settings.put({ key: `${API_KEY_PREFIX}${provider}`, value: key });
}

export async function clearApiKey(provider: Provider): Promise<void> {
  await getDb().settings.delete(`${API_KEY_PREFIX}${provider}`);
}

export async function setInferenceProfiles(
  profiles: InferenceProviderProfile[],
): Promise<void> {
  await getDb().settings.put({
    key: INFERENCE_PROFILES_KEY,
    value: JSON.stringify(profiles),
  });
}

export async function setSelectedModel(model: Model | null): Promise<void> {
  const db = getDb();
  if (model) {
    await db.settings.put({
      key: SELECTED_MODEL_KEY,
      value: JSON.stringify(model),
    });
  } else {
    await db.settings.delete(SELECTED_MODEL_KEY);
  }
}

export async function patchSettings(patch: {
  keys?: Partial<Record<Provider, string | null>>;
  inferenceProfiles?: InferenceProviderProfile[] | null;
  selectedModel?: Model | null;
  braveSearchApiKey?: string | null;
}): Promise<void> {
  if (patch.keys) {
    for (const [p, v] of Object.entries(patch.keys) as [
      Provider,
      string | null | undefined,
    ][]) {
      if (v === null || v === undefined || v === "") {
        await clearApiKey(p);
      } else {
        await setApiKey(p, v);
      }
    }
  }
  if (
    patch.inferenceProfiles !== undefined &&
    patch.inferenceProfiles !== null
  ) {
    await setInferenceProfiles(patch.inferenceProfiles);
  }
  if ("selectedModel" in patch) {
    await setSelectedModel(patch.selectedModel ?? null);
  }
  if ("braveSearchApiKey" in patch) {
    const v = patch.braveSearchApiKey;
    if (v === null || v === undefined || v === "") {
      await getDb().settings.delete(BRAVE_SEARCH_API_KEY);
    } else {
      await getDb().settings.put({ key: BRAVE_SEARCH_API_KEY, value: v });
    }
  }
}

/* ── Wiki pages ── */

export async function listWikiPages(): Promise<WikiPage[]> {
  const rows = await getDb().wikiPages.toArray();
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getWikiPageBySlug(slug: string): Promise<WikiPage | null> {
  const row = await getDb().wikiPages.where("slug").equals(slug).first();
  return row ?? null;
}

/**
 * Upsert a wiki page. Wraps the page write, revision snapshot, and
 * backlink rebuild in a single Dexie transaction — mirrors the old
 * SQLite behavior.
 */
export async function upsertWikiPage(page: {
  id: string;
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.transaction(
    "rw",
    [db.wikiPages, db.wikiRevisions, db.wikiBacklinks],
    async () => {
      const existing = await db.wikiPages.where("slug").equals(page.slug).first();

      // Archive OLD title/content/type before overwriting.
      if (existing && existing.content !== page.content) {
        await db.wikiRevisions.add({
          pageId: existing.id,
          slug: page.slug,
          title: existing.title,
          content: existing.content,
          pageType: existing.pageType,
          savedAt: now,
        });
      }

      const finalId = existing?.id ?? page.id;
      const createdAt = existing?.createdAt ?? now;
      await db.wikiPages.put({
        id: finalId,
        slug: page.slug,
        title: page.title,
        content: page.content,
        pageType: page.pageType,
        createdAt,
        updatedAt: now,
      });

      await rebuildBacklinksFor(finalId, page.content);
    },
  );
}

export async function deleteWikiPage(id: string): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [db.wikiPages, db.wikiPageSources, db.wikiBacklinks, db.wikiRevisions],
    async () => {
      await db.wikiPages.delete(id);
      await db.wikiPageSources.where("pageId").equals(id).delete();
      await db.wikiBacklinks.where("sourceId").equals(id).delete();
      await db.wikiRevisions.where("pageId").equals(id).delete();
    },
  );
}

export async function addWikiPageSource(
  pageId: string,
  reviewId: string,
): Promise<void> {
  const key = `${pageId}::${reviewId}`;
  const existing = await getDb().wikiPageSources.get(key);
  if (existing) return;
  await getDb().wikiPageSources.put({
    key,
    pageId,
    reviewId,
    passage: null,
    addedAt: new Date().toISOString(),
  });
}

export async function hasWikiSourcesForReview(
  reviewId: string,
): Promise<boolean> {
  const hit = await getDb()
    .wikiPageSources.where("reviewId")
    .equals(reviewId)
    .first();
  return !!hit;
}

export async function getWikiPageCount(): Promise<number> {
  return getDb().wikiPages.count();
}

/* ── Wiki backlinks + revisions + sources ── */

async function rebuildBacklinksFor(
  pageId: string,
  content: string,
): Promise<void> {
  const db = getDb();
  await db.wikiBacklinks.where("sourceId").equals(pageId).delete();
  const targets = extractWikiLinkSlugs(content);
  if (targets.length === 0) return;
  const rows: WikiBacklinkRow[] = targets.map((targetSlug) => ({
    key: `${pageId}::${targetSlug}`,
    sourceId: pageId,
    targetSlug,
  }));
  await db.wikiBacklinks.bulkPut(rows);
}

export interface WikiBacklink {
  sourceSlug: string;
  sourceTitle: string;
  sourcePageType: WikiPageType;
}

export async function getWikiBacklinks(slug: string): Promise<WikiBacklink[]> {
  const db = getDb();
  const rows = await db.wikiBacklinks.where("targetSlug").equals(slug).toArray();
  const result: WikiBacklink[] = [];
  for (const row of rows) {
    const page = await db.wikiPages.get(row.sourceId);
    if (!page) continue;
    result.push({
      sourceSlug: page.slug,
      sourceTitle: page.title,
      sourcePageType: page.pageType,
    });
  }
  return result.sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
}

export interface WikiPageSource {
  reviewId: string;
  reviewTitle: string | null;
  reviewArxivId: string | null;
  passage: string | null;
  addedAt: string | null;
}

export async function getWikiPageSources(
  slug: string,
): Promise<WikiPageSource[]> {
  const db = getDb();
  const page = await db.wikiPages.where("slug").equals(slug).first();
  if (!page) return [];
  const sources = await db.wikiPageSources
    .where("pageId")
    .equals(page.id)
    .toArray();
  const result: WikiPageSource[] = [];
  for (const s of sources) {
    const review = await db.reviews.get(s.reviewId);
    result.push({
      reviewId: s.reviewId,
      reviewTitle: review?.title ?? null,
      reviewArxivId: review?.arxivId ?? null,
      passage: s.passage,
      addedAt: s.addedAt,
    });
  }
  result.sort((a, b) => {
    const ax = a.addedAt ?? "";
    const bx = b.addedAt ?? "";
    return bx.localeCompare(ax);
  });
  return result;
}

export interface WikiRevisionSummary {
  id: number;
  savedAt: string;
  contentLength: number;
}

export async function listWikiRevisions(
  slug: string,
): Promise<WikiRevisionSummary[]> {
  const db = getDb();
  const page = await db.wikiPages.where("slug").equals(slug).first();
  if (!page) return [];
  const rows = await db.wikiRevisions.where("pageId").equals(page.id).toArray();
  rows.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  return rows.slice(0, 20).map((r) => ({
    id: r.id!,
    savedAt: r.savedAt,
    contentLength: r.content.length,
  }));
}

export async function getWikiRevision(id: number): Promise<{
  id: number;
  slug: string;
  title: string;
  content: string;
  savedAt: string;
} | null> {
  const row = await getDb().wikiRevisions.get(id);
  if (!row) return null;
  return {
    id: row.id!,
    slug: row.slug,
    title: row.title,
    content: row.content,
    savedAt: row.savedAt,
  };
}

/** List session pages whose date-keyed slugs fall within the inclusive range. */
export async function listSessionPagesInRange(
  startDateKey: string,
  endDateKey: string,
): Promise<
  Array<{ slug: string; title: string; content: string; updatedAt: string }>
> {
  const start = `session-${startDateKey}`;
  const end = `session-${endDateKey}`;
  const pages = await getDb()
    .wikiPages.where("pageType")
    .equals("session")
    .toArray();
  return pages
    .filter((p) => p.slug >= start && p.slug <= end)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      content: p.content,
      updatedAt: p.updatedAt,
    }));
}

/* ── Atomic wiki-ingest finalize ── */

export interface IngestFinalizeInput {
  pages: Array<{
    slug: string;
    title: string;
    content: string;
    pageType: WikiPageType;
    source?: {
      reviewId: string;
      passage?: string;
    };
  }>;
  logEntry?: {
    label: string;
    kind?: string;
  };
}

/**
 * Run a journal-write batch atomically:
 *   1. Upsert every page (new or updated) → records a revision snapshot
 *   2. Rebuild backlinks for each upserted page
 *   3. Link sources (passage + added_at) if provided
 *
 * All operations run inside a single Dexie transaction spanning
 * wikiPages, wikiRevisions, wikiBacklinks, and wikiPageSources.
 */
export async function wikiIngestFinalize(
  input: IngestFinalizeInput,
): Promise<{ savedSlugs: string[] }> {
  const db = getDb();
  const savedSlugs: string[] = [];

  await db.transaction(
    "rw",
    [db.wikiPages, db.wikiRevisions, db.wikiBacklinks, db.wikiPageSources],
    async () => {
      const now = new Date().toISOString();

      for (const page of input.pages) {
        if (!page.slug || !page.title || !page.content || !page.pageType) {
          continue;
        }

        const existing = await db.wikiPages
          .where("slug")
          .equals(page.slug)
          .first();
        const id = existing?.id ?? crypto.randomUUID();
        const createdAt = existing?.createdAt ?? now;

        if (existing && existing.content !== page.content) {
          await db.wikiRevisions.add({
            pageId: id,
            slug: page.slug,
            title: existing.title,
            content: existing.content,
            pageType: existing.pageType,
            savedAt: now,
          });
        }

        await db.wikiPages.put({
          id,
          slug: page.slug,
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          createdAt,
          updatedAt: now,
        });

        await rebuildBacklinksFor(id, page.content);

        if (page.source) {
          const key = `${id}::${page.source.reviewId}`;
          const existingSource = await db.wikiPageSources.get(key);
          await db.wikiPageSources.put({
            key,
            pageId: id,
            reviewId: page.source.reviewId,
            passage:
              page.source.passage ?? existingSource?.passage ?? null,
            addedAt: existingSource?.addedAt ?? now,
          });
        }

        savedSlugs.push(page.slug);
      }
    },
  );

  return { savedSlugs };
}

/* ── Bootstrap ── */

export async function getBootstrap(): Promise<{
  reviews: PaperReview[];
  settings: Awaited<ReturnType<typeof getSettings>>;
  globalGraph: GlobalGraphData | null;
  deepDives: DeepDiveSession[];
}> {
  const [reviews, settings, globalGraph, deepDives] = await Promise.all([
    listReviews(),
    getSettings(),
    getGlobalGraphData(),
    listDeepDives(),
  ]);
  return { reviews, settings, globalGraph, deepDives };
}
