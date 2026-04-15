/**
 * Dexie (IndexedDB) schema for Artifact's client-side store.
 *
 * This replaces the server-side better-sqlite3 store. Everything a user
 * creates — reviews, messages, annotations, deep dives, explore graphs,
 * wiki pages, settings, and PDF blobs — lives in the browser.
 */

import Dexie, { type Table } from "dexie";
import type { Annotation } from "@/lib/annotations";
import type { ChatMessage, PaperReview } from "@/lib/review-types";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type {
  GlobalGraphData,
  GraphData,
  PrerequisitesData,
} from "@/lib/explore";
import type { WikiPage, WikiPageType } from "@/lib/wiki";

export type ReviewRow = PaperReview;

export interface MessagesRow {
  reviewId: string;
  messages: ChatMessage[];
}

export interface AnnotationsRow {
  reviewId: string;
  annotations: Annotation[];
}

export type DeepDiveRow = DeepDiveSession;

export interface PrerequisitesRow {
  reviewId: string;
  data: PrerequisitesData;
}

export interface GraphRow {
  reviewId: string;
  graph: GraphData;
}

export interface GlobalGraphRow {
  id: "singleton";
  data: GlobalGraphData;
}

export type WikiPageRow = WikiPage;

export interface WikiPageSourceRow {
  // Composite key: `${pageId}::${reviewId}`
  key: string;
  pageId: string;
  reviewId: string;
  passage: string | null;
  addedAt: string | null;
}

export interface WikiBacklinkRow {
  // Composite key: `${sourceId}::${targetSlug}`
  key: string;
  sourceId: string;
  targetSlug: string;
}

export interface WikiRevisionRow {
  id?: number;
  pageId: string;
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
  savedAt: string;
}

export interface SettingsRow {
  key: string;
  value: string;
}

export interface PdfBlobRow {
  id: string;
  blob: Blob;
  name: string | null;
  createdAt: string;
}

/**
 * Dexie schema — v1. Bump the version number and add a `.upgrade()` on
 * the next store call when tables change.
 */
export class ArtifactDB extends Dexie {
  reviews!: Table<ReviewRow, string>;
  reviewMessages!: Table<MessagesRow, string>;
  reviewAnnotations!: Table<AnnotationsRow, string>;
  deepDives!: Table<DeepDiveRow, string>;
  explorePrerequisites!: Table<PrerequisitesRow, string>;
  exploreGraphs!: Table<GraphRow, string>;
  globalGraph!: Table<GlobalGraphRow, string>;
  wikiPages!: Table<WikiPageRow, string>;
  wikiPageSources!: Table<WikiPageSourceRow, string>;
  wikiBacklinks!: Table<WikiBacklinkRow, string>;
  wikiRevisions!: Table<WikiRevisionRow, number>;
  settings!: Table<SettingsRow, string>;
  pdfBlobs!: Table<PdfBlobRow, string>;

  constructor() {
    super("artifact");
    this.version(1).stores({
      reviews: "id, arxivId, createdAt",
      reviewMessages: "reviewId",
      reviewAnnotations: "reviewId",
      deepDives: "id, reviewId, createdAt",
      explorePrerequisites: "reviewId",
      exploreGraphs: "reviewId",
      globalGraph: "id",
      wikiPages: "id, &slug, pageType, updatedAt",
      wikiPageSources: "key, pageId, reviewId",
      wikiBacklinks: "key, sourceId, targetSlug",
      wikiRevisions: "++id, pageId, slug, savedAt",
      settings: "key",
      pdfBlobs: "id",
    });
  }
}

let _db: ArtifactDB | null = null;

/**
 * Lazy singleton. Returns null during SSR — callers must guard for it.
 * Never instantiate Dexie on the server because `indexedDB` is undefined
 * and Dexie will throw on import-time side effects.
 */
export function getDb(): ArtifactDB {
  if (typeof window === "undefined") {
    throw new Error("ArtifactDB is only available in the browser");
  }
  if (!_db) _db = new ArtifactDB();
  return _db;
}

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}
