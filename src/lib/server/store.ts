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

/* ── Bootstrap ── */

export function getBootstrap() {
  return {
    reviews: listReviews(),
    settings: getSettings(),
    globalGraph: getGlobalGraphData(),
    deepDives: listDeepDives(),
  };
}
