import "server-only";

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { InferenceProviderProfile, Provider } from "@/lib/models";
import type { Model } from "@/lib/models";
import { BUILTIN_PROVIDER_ORDER, isInferenceProviderType } from "@/lib/models";
import type { PaperReview, ChatMessage } from "@/lib/review-types";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type {
  GlobalGraphData,
  GraphData,
  PrerequisitesData,
} from "@/lib/explore";
import type { WikiPage, WikiPageType } from "@/lib/wiki";

const DB_PATH = path.join(process.cwd(), "data", "artifact.db");

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    initSchema(dbInstance);
  }
  return dbInstance;
}

const INFERENCE_PROFILES_KEY = "inference_profiles";


function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      arxiv_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_arxiv ON reviews(arxiv_id);

    CREATE TABLE IF NOT EXISTS review_messages (
      review_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_annotations (
      review_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deep_dives (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      paper_title TEXT NOT NULL,
      arxiv_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      explanation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS explore_prerequisites (
      review_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS explore_graphs (
      review_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS global_graph (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateDeepDivesReviewFk(db);
  migrateReviewsLocalPdf(db);
  migrateReviewsSourceUrl(db);
  migrateWikiPages(db);
  migrateWikiBacklinks(db);
  migrateWikiPageSourcesPassage(db);
  migrateWikiRevisions(db);
}

/** Older DBs created deep_dives without a FK; recreate so DELETE FROM reviews cascades. */
function migrateDeepDivesReviewFk(db: Database.Database) {
  let fkRows: Array<{ table: string; from: string; on_delete: string }>;
  try {
    fkRows = db.prepare(`PRAGMA foreign_key_list(deep_dives)`).all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
  } catch {
    return;
  }
  const hasCascade = fkRows.some(
    (r) =>
      r.table === "reviews" &&
      r.from === "review_id" &&
      String(r.on_delete).toUpperCase() === "CASCADE",
  );
  if (hasCascade) return;

  db.exec(`
    BEGIN;
    DELETE FROM deep_dives WHERE review_id NOT IN (SELECT id FROM reviews);
    CREATE TABLE deep_dives__new (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      paper_title TEXT NOT NULL,
      arxiv_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      explanation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );
    INSERT INTO deep_dives__new SELECT * FROM deep_dives;
    DROP TABLE deep_dives;
    ALTER TABLE deep_dives__new RENAME TO deep_dives;
    COMMIT;
  `);
}

/** Add pdf_path column and make arxiv_id nullable for local PDF support. */
function migrateReviewsLocalPdf(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(reviews)`).all() as Array<{
    name: string;
    notnull: number;
  }>;
  const hasPdfPath = cols.some((c) => c.name === "pdf_path");
  if (!hasPdfPath) {
    db.exec(`ALTER TABLE reviews ADD COLUMN pdf_path TEXT`);
  }
  // SQLite doesn't support ALTER COLUMN, but we need arxiv_id to be nullable.
  // Recreate the table if arxiv_id is still NOT NULL.
  const arxivCol = cols.find((c) => c.name === "arxiv_id");
  if (arxivCol && arxivCol.notnull === 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE reviews__new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        arxiv_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        pdf_path TEXT
      );
      INSERT INTO reviews__new (id, title, arxiv_id, created_at, updated_at, pdf_path)
        SELECT id, title, arxiv_id, created_at, updated_at, pdf_path FROM reviews;
      DROP TABLE reviews;
      ALTER TABLE reviews__new RENAME TO reviews;
      CREATE INDEX IF NOT EXISTS idx_reviews_arxiv ON reviews(arxiv_id);
      COMMIT;
    `);
  }
}

/** Add source_url column for arbitrary web page reviews. */
function migrateReviewsSourceUrl(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(reviews)`).all() as Array<{
    name: string;
  }>;
  const hasSourceUrl = cols.some((c) => c.name === "source_url");
  if (!hasSourceUrl) {
    db.exec(`ALTER TABLE reviews ADD COLUMN source_url TEXT`);
  }
}

/* ── Reviews ── */

export function listReviews(): PaperReview[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, arxiv_id AS arxivId, created_at AS createdAt, updated_at AS updatedAt, pdf_path AS pdfPath, source_url AS sourceUrl
       FROM reviews ORDER BY datetime(created_at) DESC`,
    )
    .all() as PaperReview[];
  return rows;
}

export function getReview(id: string): PaperReview | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, arxiv_id AS arxivId, created_at AS createdAt, updated_at AS updatedAt, pdf_path AS pdfPath, source_url AS sourceUrl
       FROM reviews WHERE id = ?`,
    )
    .get(id) as PaperReview | undefined;
  return row;
}

export function getReviewByArxivId(arxivId: string): PaperReview | undefined {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, arxiv_id AS arxivId, created_at AS createdAt, updated_at AS updatedAt, pdf_path AS pdfPath, source_url AS sourceUrl
       FROM reviews WHERE lower(arxiv_id) = lower(?)`,
    )
    .all(arxivId) as PaperReview[];
  return rows[0];
}

export function insertReview(review: PaperReview): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO reviews (id, title, arxiv_id, created_at, updated_at, pdf_path, source_url)
     VALUES (@id, @title, @arxiv_id, @created_at, @updated_at, @pdf_path, @source_url)`,
  ).run({
    id: review.id,
    title: review.title,
    arxiv_id: review.arxivId,
    created_at: review.createdAt,
    updated_at: review.updatedAt,
    pdf_path: review.pdfPath ?? null,
    source_url: review.sourceUrl ?? null,
  });
}

/** Deletes the review and cascades to messages, annotations, explore rows, and deep_dives. */
export function deleteReview(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM reviews WHERE id = ?`).run(id);
  return result.changes > 0;
}

/* ── Messages ── */

export function getMessages(reviewId: string): ChatMessage[] {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM review_messages WHERE review_id = ?`)
    .get(reviewId) as { payload: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.payload) as ChatMessage[];
  } catch (err) {
    console.warn(
      `[store] Failed to parse messages for review ${reviewId}:`,
      err,
    );
    return [];
  }
}

export function setMessages(reviewId: string, messages: ChatMessage[]): void {
  const db = getDb();
  const payload = JSON.stringify(messages);
  db.prepare(
    `INSERT INTO review_messages (review_id, payload) VALUES (?, ?)
     ON CONFLICT(review_id) DO UPDATE SET payload = excluded.payload`,
  ).run(reviewId, payload);
}

/* ── Annotations ── */

export function getAnnotations(reviewId: string): Annotation[] {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM review_annotations WHERE review_id = ?`)
    .get(reviewId) as { payload: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.payload) as Annotation[];
  } catch (err) {
    console.warn(
      `[store] Failed to parse annotations for review ${reviewId}:`,
      err,
    );
    return [];
  }
}

export function setAnnotations(
  reviewId: string,
  annotations: Annotation[],
): void {
  const db = getDb();
  const payload = JSON.stringify(annotations);
  db.prepare(
    `INSERT INTO review_annotations (review_id, payload) VALUES (?, ?)
     ON CONFLICT(review_id) DO UPDATE SET payload = excluded.payload`,
  ).run(reviewId, payload);
}

/* ── Deep dives ── */

export function listDeepDives(): DeepDiveSession[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, review_id AS reviewId, paper_title AS paperTitle, arxiv_id AS arxivId,
              topic, explanation, created_at AS createdAt
       FROM deep_dives ORDER BY datetime(created_at) DESC`,
    )
    .all() as DeepDiveSession[];
}

export function insertDeepDive(session: DeepDiveSession): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO deep_dives (id, review_id, paper_title, arxiv_id, topic, explanation, created_at)
     VALUES (@id, @review_id, @paper_title, @arxiv_id, @topic, @explanation, @created_at)`,
  ).run({
    id: session.id,
    review_id: session.reviewId,
    paper_title: session.paperTitle,
    arxiv_id: session.arxivId,
    topic: session.topic,
    explanation: session.explanation,
    created_at: session.createdAt,
  });
}

/* ── Explore (per review) ── */

export function getPrerequisites(reviewId: string): PrerequisitesData | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM explore_prerequisites WHERE review_id = ?`)
    .get(reviewId) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as PrerequisitesData;
  } catch (err) {
    console.warn(
      `[store] Failed to parse prerequisites for review ${reviewId}:`,
      err,
    );
    return null;
  }
}

export function setPrerequisites(
  reviewId: string,
  data: PrerequisitesData,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO explore_prerequisites (review_id, payload) VALUES (?, ?)
     ON CONFLICT(review_id) DO UPDATE SET payload = excluded.payload`,
  ).run(reviewId, JSON.stringify(data));
}

export function getGraphData(reviewId: string): GraphData | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM explore_graphs WHERE review_id = ?`)
    .get(reviewId) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as GraphData;
  } catch (err) {
    console.warn(
      `[store] Failed to parse graph data for review ${reviewId}:`,
      err,
    );
    return null;
  }
}

export function setGraphData(reviewId: string, graph: GraphData): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO explore_graphs (review_id, payload) VALUES (?, ?)
     ON CONFLICT(review_id) DO UPDATE SET payload = excluded.payload`,
  ).run(reviewId, JSON.stringify(graph));
}

export function clearExploreData(reviewId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM explore_prerequisites WHERE review_id = ?`).run(
    reviewId,
  );
  db.prepare(`DELETE FROM explore_graphs WHERE review_id = ?`).run(reviewId);
}

/* ── Global graph ── */

export function getGlobalGraphData(): GlobalGraphData | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM global_graph WHERE singleton = 1`)
    .get() as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as GlobalGraphData;
  } catch (err) {
    console.warn("[store] Failed to parse global graph data:", err);
    return null;
  }
}

export function setGlobalGraphData(data: GlobalGraphData): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO global_graph (singleton, payload) VALUES (1, ?)
     ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload`,
  ).run(JSON.stringify(data));
}

export function clearGlobalKnowledgeGraph(): void {
  const db = getDb();
  db.prepare(`DELETE FROM global_graph WHERE singleton = 1`).run();
}

/* ── Settings (API keys + selected model) ── */

function parseInferenceProfiles(
  db: Database.Database,
): InferenceProviderProfile[] {
  const row = db
    .prepare(`SELECT value FROM app_kv WHERE key = ?`)
    .get(INFERENCE_PROFILES_KEY) as { value: string } | undefined;
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? (parsed as InferenceProviderProfile[]) : [];
  } catch {
    return [];
  }
}

export function getInferenceProfile(
  id: string,
): InferenceProviderProfile | undefined {
  return parseInferenceProfiles(getDb()).find((p) => p.id === id);
}

export function getSettings(): {
  keys: Partial<Record<Provider, string>>;
  inferenceProfiles: InferenceProviderProfile[];
  selectedModel: Model | null;
} {
  const db = getDb();
  const keys: Partial<Record<Provider, string>> = {};
  for (const p of BUILTIN_PROVIDER_ORDER) {
    const row = db
      .prepare(`SELECT value FROM app_kv WHERE key = ?`)
      .get(`api_key:${p}`) as { value: string } | undefined;
    if (row?.value) keys[p] = row.value;
  }
  const inferenceProfiles = parseInferenceProfiles(db);
  const modelRow = db
    .prepare(`SELECT value FROM app_kv WHERE key = ?`)
    .get("selected_model") as { value: string } | undefined;
  let selectedModel: Model | null = null;
  if (modelRow?.value) {
    try {
      selectedModel = JSON.parse(modelRow.value) as Model;
    } catch (err) {
      console.warn("[store] Failed to parse selected model:", err);
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
  return { keys, inferenceProfiles, selectedModel };
}

export function setApiKey(provider: Provider, key: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(`api_key:${provider}`, key);
}

export function clearApiKey(provider: Provider): void {
  const db = getDb();
  db.prepare(`DELETE FROM app_kv WHERE key = ?`).run(`api_key:${provider}`);
}

export function setInferenceProfiles(
  profiles: InferenceProviderProfile[],
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(INFERENCE_PROFILES_KEY, JSON.stringify(profiles));
}

export function setSelectedModel(model: Model | null): void {
  const db = getDb();
  if (model) {
    db.prepare(
      `INSERT INTO app_kv (key, value) VALUES ('selected_model', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(JSON.stringify(model));
  } else {
    db.prepare(`DELETE FROM app_kv WHERE key = ?`).run("selected_model");
  }
}

export function patchSettings(patch: {
  keys?: Partial<Record<Provider, string | null>>;
  inferenceProfiles?: InferenceProviderProfile[] | null;
  selectedModel?: Model | null;
}): void {
  if (patch.keys) {
    for (const [p, v] of Object.entries(patch.keys) as [
      Provider,
      string | null | undefined,
    ][]) {
      if (v === null || v === undefined || v === "") {
        clearApiKey(p);
      } else {
        setApiKey(p, v);
      }
    }
  }
  if (
    patch.inferenceProfiles !== undefined &&
    patch.inferenceProfiles !== null
  ) {
    setInferenceProfiles(patch.inferenceProfiles);
  }
  if ("selectedModel" in patch) {
    setSelectedModel(patch.selectedModel ?? null);
  }
}

/* ── Wiki pages ── */

/** Add wiki_pages and wiki_page_sources tables (idempotent migration). */
function migrateWikiPages(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      page_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_slug ON wiki_pages(slug);
    CREATE INDEX IF NOT EXISTS idx_wiki_type ON wiki_pages(page_type);

    CREATE TABLE IF NOT EXISTS wiki_page_sources (
      page_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      PRIMARY KEY (page_id, review_id),
      FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );
  `);
}

export function listWikiPages(): WikiPage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, slug, title, content, page_type AS pageType,
              created_at AS createdAt, updated_at AS updatedAt
       FROM wiki_pages ORDER BY datetime(updated_at) DESC`,
    )
    .all() as WikiPage[];
}

export function getWikiPageBySlug(slug: string): WikiPage | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, slug, title, content, page_type AS pageType,
              created_at AS createdAt, updated_at AS updatedAt
       FROM wiki_pages WHERE slug = ?`,
    )
    .get(slug) as WikiPage | undefined;
  return row ?? null;
}

export function upsertWikiPage(page: {
  id: string;
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  // Wrap in a transaction so the page write, revision snapshot, and
  // backlink rebuild are atomic even when called outside wikiIngestFinalize.
  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id, content FROM wiki_pages WHERE slug = ?`)
      .get(page.slug) as { id: string; content: string } | undefined;

    if (existing && existing.content !== page.content) {
      db.prepare(
        `INSERT INTO wiki_page_revisions (page_id, slug, title, content, page_type, saved_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        existing.id,
        page.slug,
        page.title,
        existing.content,
        page.pageType,
        now,
      );
    }

    db.prepare(
      `INSERT INTO wiki_pages (id, slug, title, content, page_type, created_at, updated_at)
       VALUES (@id, @slug, @title, @content, @page_type, @now, @now)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         page_type = excluded.page_type,
         updated_at = excluded.updated_at`,
    ).run({
      id: page.id,
      slug: page.slug,
      title: page.title,
      content: page.content,
      page_type: page.pageType,
      now,
    });

    // Resolve the id the page ended up with (existing wins on conflict).
    const finalId =
      (db
        .prepare(`SELECT id FROM wiki_pages WHERE slug = ?`)
        .get(page.slug) as { id: string } | undefined)?.id ?? page.id;
    rebuildBacklinksFor(db, finalId, page.content);
  });
  tx();
}

export function deleteWikiPage(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM wiki_pages WHERE id = ?`).run(id);
}

export function addWikiPageSource(pageId: string, reviewId: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO wiki_page_sources (page_id, review_id) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(pageId, reviewId);
}

export function hasWikiSourcesForReview(reviewId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM wiki_page_sources WHERE review_id = ? LIMIT 1`,
    )
    .get(reviewId);
  return !!row;
}

export function searchWikiPages(query: string): WikiPage[] {
  const db = getDb();
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT id, slug, title, content, page_type AS pageType,
              created_at AS createdAt, updated_at AS updatedAt
       FROM wiki_pages
       WHERE title LIKE ? OR content LIKE ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 20`,
    )
    .all(pattern, pattern) as WikiPage[];
}

export function getWikiPageCount(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM wiki_pages WHERE page_type NOT IN ('index', 'log')`)
    .get() as { cnt: number };
  return row.cnt;
}

/* ── Wiki backlinks + revisions + source-passages (Tier 2/3) ── */

/**
 * Add the `wiki_page_backlinks` table: stores every `[[slug]]` reference
 * found in page content so we can render "Referenced in" cheaply AND
 * detect broken references during lint. Target is stored as slug (not id)
 * so we still track dangling refs after a target is deleted.
 */
function migrateWikiBacklinks(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_page_backlinks (
      source_id TEXT NOT NULL,
      target_slug TEXT NOT NULL,
      PRIMARY KEY (source_id, target_slug),
      FOREIGN KEY (source_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_backlinks_target ON wiki_page_backlinks(target_slug);
  `);
}

/** Attach the originating passage to each (page, review) source row. */
function migrateWikiPageSourcesPassage(db: Database.Database) {
  const cols = db
    .prepare(`PRAGMA table_info(wiki_page_sources)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "passage")) {
    db.exec(`ALTER TABLE wiki_page_sources ADD COLUMN passage TEXT`);
  }
  if (!cols.some((c) => c.name === "added_at")) {
    db.exec(`ALTER TABLE wiki_page_sources ADD COLUMN added_at TEXT`);
  }
}

/** Append-only revision history so diff-on-update has data to show. */
function migrateWikiRevisions(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_page_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      page_type TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_page_revisions(page_id, saved_at);
  `);
}

/** Extract `[[slug]]` tokens from markdown. Case-insensitive, deduped. */
function extractWikiLinks(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([a-z0-9][a-z0-9-]{0,79})\]\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** Rebuild the `wiki_page_backlinks` rows for a single source page. */
function rebuildBacklinksFor(
  db: Database.Database,
  pageId: string,
  content: string,
): void {
  db.prepare(`DELETE FROM wiki_page_backlinks WHERE source_id = ?`).run(pageId);
  const targets = extractWikiLinks(content);
  if (targets.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO wiki_page_backlinks (source_id, target_slug) VALUES (?, ?)`,
  );
  for (const t of targets) insert.run(pageId, t);
}

export interface WikiBacklink {
  sourceSlug: string;
  sourceTitle: string;
  sourcePageType: WikiPageType;
}

export function getWikiBacklinks(slug: string): WikiBacklink[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.slug AS sourceSlug, p.title AS sourceTitle, p.page_type AS sourcePageType
       FROM wiki_page_backlinks bl
       JOIN wiki_pages p ON p.id = bl.source_id
       WHERE bl.target_slug = ?
       ORDER BY p.title`,
    )
    .all(slug) as WikiBacklink[];
}

export interface WikiPageSource {
  reviewId: string;
  reviewTitle: string | null;
  reviewArxivId: string | null;
  passage: string | null;
  addedAt: string | null;
}

export function getWikiPageSources(slug: string): WikiPageSource[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.review_id AS reviewId,
              r.title AS reviewTitle,
              r.arxiv_id AS reviewArxivId,
              s.passage AS passage,
              s.added_at AS addedAt
       FROM wiki_page_sources s
       JOIN wiki_pages p ON p.id = s.page_id
       LEFT JOIN reviews r ON r.id = s.review_id
       WHERE p.slug = ?
       ORDER BY datetime(COALESCE(s.added_at, r.created_at, '')) DESC`,
    )
    .all(slug) as WikiPageSource[];
}

export interface WikiRevisionSummary {
  id: number;
  savedAt: string;
  contentLength: number;
}

export function listWikiRevisions(slug: string): WikiRevisionSummary[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT rev.id AS id, rev.saved_at AS savedAt, LENGTH(rev.content) AS contentLength
       FROM wiki_page_revisions rev
       JOIN wiki_pages p ON p.id = rev.page_id
       WHERE p.slug = ?
       ORDER BY rev.id DESC
       LIMIT 20`,
    )
    .all(slug) as WikiRevisionSummary[];
}

export function getWikiRevision(
  id: number,
): { id: number; slug: string; title: string; content: string; savedAt: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, slug, title, content, saved_at AS savedAt FROM wiki_page_revisions WHERE id = ?`,
    )
    .get(id) as
    | { id: number; slug: string; title: string; content: string; savedAt: string }
    | undefined;
  return row ?? null;
}

/* ── Atomic wiki-ingest finalize (T2.1) ── */

export interface IngestFinalizeInput {
  /** Pages to upsert in a single transaction. */
  pages: Array<{
    slug: string;
    title: string;
    content: string;
    pageType: WikiPageType;
    /** If set, also record a (page, review) source row with passage/addedAt. */
    source?: {
      reviewId: string;
      passage?: string;
    };
  }>;
  /** Short human label for the log entry. If omitted, no log is appended. */
  logEntry?: {
    label: string;
    /** e.g. "ingest", "update", "chat-extract". Defaults to "ingest". */
    kind?: string;
  };
  /** Whether to rebuild the knowledge-base index page after this batch. */
  rebuildIndex?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  paper: "Papers",
  concept: "Concepts",
  method: "Methods",
  entity: "Entities",
  graph: "Knowledge Graphs",
};

function buildIndexContent(db: Database.Database): string {
  const rows = db
    .prepare(
      `SELECT slug, title, content, page_type AS pageType, updated_at AS updatedAt
       FROM wiki_pages
       WHERE page_type NOT IN ('index', 'log')
       ORDER BY page_type, title`,
    )
    .all() as Array<{
    slug: string;
    title: string;
    content: string;
    pageType: string;
    updatedAt: string;
  }>;
  if (rows.length === 0) return "";

  const grouped = new Map<string, typeof rows>();
  for (const p of rows) {
    const list = grouped.get(p.pageType) ?? [];
    list.push(p);
    grouped.set(p.pageType, list);
  }

  let content = "# Knowledge Base Index\n\n";
  content += `*${rows.length} pages across ${grouped.size} categories*\n\n`;
  for (const [type, pages] of grouped) {
    content += `## ${TYPE_LABELS[type] ?? type}\n\n`;
    for (const p of pages) {
      const firstLine = p.content
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"));
      const excerpt = firstLine
        ? firstLine.trim().slice(0, 100) + (firstLine.length > 100 ? "…" : "")
        : "";
      content += `- [[${p.slug}]] — ${excerpt}\n`;
    }
    content += "\n";
  }
  return content;
}

function appendLogEntry(
  db: Database.Database,
  kind: string,
  label: string,
  now: string,
): void {
  const date = now.slice(0, 10);
  const time = now.slice(11, 16);
  const entry = `- \`${date} ${time}\` **${kind}** — ${label}\n`;

  const existing = db
    .prepare(`SELECT id, content FROM wiki_pages WHERE slug = 'log'`)
    .get() as { id: string; content: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE wiki_pages SET content = ?, updated_at = ? WHERE id = ?`,
    ).run(existing.content + entry, now, existing.id);
  } else {
    const header = `# Knowledge Base Log\n\nChronological record of knowledge base operations.\n\n`;
    db.prepare(
      `INSERT INTO wiki_pages (id, slug, title, content, page_type, created_at, updated_at)
       VALUES (?, 'log', 'Knowledge Base Log', ?, 'log', ?, ?)`,
    ).run(crypto.randomUUID(), header + entry, now, now);
  }
}

/**
 * Run a wiki-ingest batch atomically on the server:
 *   1. Upsert every page (new or updated) → also records a revision snapshot.
 *   2. Rebuild backlinks for each upserted page.
 *   3. Link sources (passage + added_at) if provided.
 *   4. Rebuild the `index` page from the freshly-committed state.
 *   5. Append a log entry.
 *
 * All of this runs inside a single better-sqlite3 transaction, which
 * makes it safe against concurrent ingests. The `index` page can no
 * longer be clobbered by a slower parallel ingest because the SELECT +
 * UPSERT happen in a single serialized write window.
 */
export function wikiIngestFinalize(
  input: IngestFinalizeInput,
): { savedSlugs: string[] } {
  const db = getDb();
  const savedSlugs: string[] = [];

  const tx = db.transaction((batch: IngestFinalizeInput) => {
    const now = new Date().toISOString();

    for (const page of batch.pages) {
      if (!page.slug || !page.title || !page.content || !page.pageType) continue;

      const existing = db
        .prepare(`SELECT id, content FROM wiki_pages WHERE slug = ?`)
        .get(page.slug) as { id: string; content: string } | undefined;

      const id = existing?.id ?? crypto.randomUUID();

      // Save revision snapshot BEFORE overwriting (only if content changed)
      if (existing && existing.content !== page.content) {
        db.prepare(
          `INSERT INTO wiki_page_revisions (page_id, slug, title, content, page_type, saved_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, page.slug, page.title, existing.content, page.pageType, now);
      }

      if (existing) {
        db.prepare(
          `UPDATE wiki_pages
             SET title = ?, content = ?, page_type = ?, updated_at = ?
           WHERE id = ?`,
        ).run(page.title, page.content, page.pageType, now, id);
      } else {
        db.prepare(
          `INSERT INTO wiki_pages (id, slug, title, content, page_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, page.slug, page.title, page.content, page.pageType, now, now);
      }

      rebuildBacklinksFor(db, id, page.content);

      if (page.source) {
        db.prepare(
          `INSERT INTO wiki_page_sources (page_id, review_id, passage, added_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(page_id, review_id) DO UPDATE SET
             passage = COALESCE(excluded.passage, wiki_page_sources.passage),
             added_at = COALESCE(wiki_page_sources.added_at, excluded.added_at)`,
        ).run(id, page.source.reviewId, page.source.passage ?? null, now);
      }

      savedSlugs.push(page.slug);
    }

    if (batch.rebuildIndex) {
      const indexContent = buildIndexContent(db);
      if (indexContent) {
        const existingIndex = db
          .prepare(`SELECT id FROM wiki_pages WHERE slug = 'index'`)
          .get() as { id: string } | undefined;
        if (existingIndex) {
          db.prepare(
            `UPDATE wiki_pages SET title = ?, content = ?, page_type = 'index', updated_at = ? WHERE id = ?`,
          ).run("Knowledge Base Index", indexContent, now, existingIndex.id);
        } else {
          db.prepare(
            `INSERT INTO wiki_pages (id, slug, title, content, page_type, created_at, updated_at)
             VALUES (?, 'index', 'Knowledge Base Index', ?, 'index', ?, ?)`,
          ).run(crypto.randomUUID(), indexContent, now, now);
        }
      }
    }

    if (batch.logEntry) {
      appendLogEntry(
        db,
        batch.logEntry.kind ?? "ingest",
        batch.logEntry.label,
        now,
      );
    }
  });

  tx(input);
  return { savedSlugs };
}

/* ── Bootstrap ── */

export function getBootstrap() {
  return {
    reviews: listReviews(),
    settings: getSettings(),
    globalGraph: getGlobalGraphData(),
    deepDives: listDeepDives(),
  };
}
