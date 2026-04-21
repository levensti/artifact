/**
 * Shareable bundle format for reviews and journal pages.
 *
 * A bundle is a plain JSON file — no zip, no binary payloads. PDFs are
 * deliberately excluded: on import the recipient's app re-fetches the
 * document from `arxivId` or `sourceUrl`, which sidesteps copyright and
 * keeps bundles small enough to email or pass through a chat app.
 *
 * Every bundle is wrapped in an envelope with a `schemaVersion` so that
 * future schema migrations can branch on it. The runtime validator below
 * is intentionally strict: it's the only thing standing between a
 * user-supplied JSON blob and a Dexie transaction that writes to the
 * recipient's local store, so "trust nothing" is the rule.
 */

import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { PrerequisitesData } from "@/lib/explore";
import type { ChatMessage, PaperReview } from "@/lib/review-types";
import type { WikiPage } from "@/lib/wiki";

/** Bump this whenever the shape of a bundle changes in a breaking way. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export type BundleType = "review" | "wiki";

export interface BundleEnvelope<T extends BundleType, D> {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  type: T;
  exportedAt: string;
  /** Free-form app identifier; informational only. */
  appVersion?: string;
  data: D;
}

/** Review contents that travel in a bundle. No PDF, no settings. */
export interface ReviewBundleData {
  review: PaperReview;
  messages: ChatMessage[];
  annotations: Annotation[];
  deepDives: DeepDiveSession[];
  prerequisites: PrerequisitesData | null;
}

/** Wiki contents. `pages[0]` is the "root" export; the rest are transitively-linked pages. */
export interface WikiBundleData {
  pages: WikiPage[];
}

export type ReviewBundle = BundleEnvelope<"review", ReviewBundleData>;
export type WikiBundle = BundleEnvelope<"wiki", WikiBundleData>;
export type AnyBundle = ReviewBundle | WikiBundle;

/* ─── Runtime validation ───────────────────────────────────────────
 *
 * Hand-rolled rather than schema-library-based to avoid adding a dep.
 * We only validate the outermost shape and the fields we actually
 * read during import; nested content (message blocks, graph nodes)
 * passes through unchecked but is contained within the bundle-owned
 * JSON tree, so a malformed nested value degrades gracefully into a
 * rendering issue rather than a DB corruption.
 */

type Issues = string[];

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function validateReviewRow(v: unknown, issues: Issues, path: string): boolean {
  if (!isObj(v)) {
    issues.push(`${path}: expected object`);
    return false;
  }
  if (!isStr(v.id) || !v.id) issues.push(`${path}.id: required string`);
  if (!isStr(v.title)) issues.push(`${path}.title: required string`);
  if (!isStr(v.createdAt)) issues.push(`${path}.createdAt: required string`);
  if (!isStr(v.updatedAt)) issues.push(`${path}.updatedAt: required string`);
  // Nullable source fields — exactly one of arxivId/sourceUrl/pdfPath should
  // be set in native data, but an imported bundle for a local-PDF review
  // should never reach us in the first place (export is gated upstream).
  if (!("arxivId" in v)) issues.push(`${path}.arxivId: required (nullable)`);
  if (!("sourceUrl" in v)) issues.push(`${path}.sourceUrl: required (nullable)`);
  return issues.length === 0;
}

function validateWikiPage(v: unknown, issues: Issues, path: string): boolean {
  if (!isObj(v)) {
    issues.push(`${path}: expected object`);
    return false;
  }
  if (!isStr(v.id) || !v.id) issues.push(`${path}.id: required string`);
  if (!isStr(v.slug) || !v.slug) issues.push(`${path}.slug: required string`);
  if (!isStr(v.title)) issues.push(`${path}.title: required string`);
  if (!isStr(v.content)) issues.push(`${path}.content: required string`);
  if (v.pageType !== "session" && v.pageType !== "digest") {
    issues.push(`${path}.pageType: expected 'session' | 'digest'`);
  }
  if (!isStr(v.createdAt)) issues.push(`${path}.createdAt: required string`);
  if (!isStr(v.updatedAt)) issues.push(`${path}.updatedAt: required string`);
  return issues.length === 0;
}

export interface ValidationResult<T> {
  ok: boolean;
  bundle?: T;
  issues: string[];
}

/** Validate an untrusted JSON tree and narrow it to a bundle type on success. */
export function validateBundle(raw: unknown): ValidationResult<AnyBundle> {
  const issues: Issues = [];
  if (!isObj(raw)) {
    return { ok: false, issues: ["bundle: expected object at root"] };
  }
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    issues.push(
      `bundle.schemaVersion: expected ${CURRENT_SCHEMA_VERSION}, got ${String(
        raw.schemaVersion,
      )}`,
    );
  }
  if (raw.type !== "review" && raw.type !== "wiki") {
    issues.push(`bundle.type: expected 'review' | 'wiki'`);
    return { ok: false, issues };
  }
  if (!isStr(raw.exportedAt)) {
    issues.push(`bundle.exportedAt: required string`);
  }
  const data = raw.data;
  if (!isObj(data)) {
    issues.push(`bundle.data: expected object`);
    return { ok: false, issues };
  }

  if (raw.type === "review") {
    validateReviewRow(data.review, issues, "bundle.data.review");
    if (!isArr(data.messages))
      issues.push("bundle.data.messages: expected array");
    if (!isArr(data.annotations))
      issues.push("bundle.data.annotations: expected array");
    if (!isArr(data.deepDives))
      issues.push("bundle.data.deepDives: expected array");
    if (!("prerequisites" in data))
      issues.push("bundle.data.prerequisites: required (nullable)");
  } else {
    if (!isArr(data.pages) || data.pages.length === 0) {
      issues.push("bundle.data.pages: expected non-empty array");
    } else {
      data.pages.forEach((p, i) =>
        validateWikiPage(p, issues, `bundle.data.pages[${i}]`),
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, bundle: raw as unknown as AnyBundle, issues: [] };
}

/** Filename-safe slug derived from a title; always non-empty. */
export function bundleFilename(type: BundleType, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safe = slug || (type === "review" ? "review" : "journal-entry");
  return `${type === "review" ? "review" : "journal"}-${safe}.json`;
}
