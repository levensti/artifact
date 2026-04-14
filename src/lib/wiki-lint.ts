/**
 * Client-side wiki lint pass.
 *
 * Inspects the local wiki for Karpathy-style health issues — broken
 * [[slug]] refs, orphans, stale pages, and very-short stubs — and
 * returns a structured result that the Wiki Health UI can render. This
 * is advisory, not blocking: failing lint never prevents ingest or
 * writes; it just surfaces in the /wiki sidebar so the user knows what
 * their background agent is maintaining.
 */

import type { WikiPage } from "@/lib/wiki";
import { loadWikiPages } from "@/lib/client-data";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";

export interface WikiLintBrokenRef {
  sourceSlug: string;
  sourceTitle: string;
  targetSlug: string;
}

export interface WikiLintOrphan {
  slug: string;
  title: string;
  pageType: string;
  updatedAt: string;
}

export interface WikiLintStale {
  slug: string;
  title: string;
  updatedAt: string;
  /** Days since last update. */
  ageDays: number;
}

export interface WikiLintStub {
  slug: string;
  title: string;
  wordCount: number;
}

export interface WikiLintReport {
  generatedAt: string;
  totalPages: number;
  brokenRefs: WikiLintBrokenRef[];
  orphans: WikiLintOrphan[];
  stale: WikiLintStale[];
  stubs: WikiLintStub[];
}

const STALE_DAYS = 30;
const STUB_WORD_LIMIT = 60;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

/** Main entry: run all lint checks against the current wiki state. */
export async function runWikiLint(): Promise<WikiLintReport> {
  const pages = await loadWikiPages();
  return lintPages(pages);
}

/** Pure version, usable from tests without the client-data cache. */
export function lintPages(pages: WikiPage[]): WikiLintReport {
  const contentPages = pages.filter(
    (p) => p.pageType !== "index" && p.pageType !== "log",
  );
  const slugIndex = new Map(contentPages.map((p) => [p.slug, p]));

  const brokenRefs: WikiLintBrokenRef[] = [];
  const inbound = new Map<string, number>();

  for (const p of contentPages) {
    const targets = extractWikiLinkSlugs(p.content);
    for (const target of targets) {
      if (!slugIndex.has(target)) {
        brokenRefs.push({
          sourceSlug: p.slug,
          sourceTitle: p.title,
          targetSlug: target,
        });
      } else {
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
      }
    }
  }

  const orphans: WikiLintOrphan[] = contentPages
    .filter(
      (p) =>
        p.pageType !== "paper" && // paper pages don't need incoming links
        (inbound.get(p.slug) ?? 0) === 0,
    )
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      pageType: p.pageType,
      updatedAt: p.updatedAt,
    }));

  const stale: WikiLintStale[] = contentPages
    .map((p) => ({ page: p, age: daysSince(p.updatedAt) }))
    .filter((x) => x.age >= STALE_DAYS)
    .map(({ page, age }) => ({
      slug: page.slug,
      title: page.title,
      updatedAt: page.updatedAt,
      ageDays: age,
    }));

  const stubs: WikiLintStub[] = contentPages
    .map((p) => ({ page: p, wc: wordCount(p.content) }))
    .filter((x) => x.wc < STUB_WORD_LIMIT)
    .map(({ page, wc }) => ({
      slug: page.slug,
      title: page.title,
      wordCount: wc,
    }));

  return {
    generatedAt: new Date().toISOString(),
    totalPages: contentPages.length,
    brokenRefs,
    orphans,
    stale,
    stubs,
  };
}
