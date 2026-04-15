/**
 * Wiki (journal) bundle export. Given a root page slug, walks `[[slug]]`
 * references transitively to an optional depth and bundles everything
 * into a single JSON envelope.
 *
 * Depth 0 = just the root page. Depth 1 (default) = root + pages directly
 * linked from it. The walk is bounded and deduped; we cap depth in code
 * rather than trusting arbitrary user input.
 */

import * as store from "@/lib/client/store";
import type { WikiPage } from "@/lib/wiki";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import {
  bundleFilename,
  CURRENT_SCHEMA_VERSION,
  type WikiBundle,
} from "./bundle-format";
import { triggerDownload } from "./download";

const MAX_DEPTH = 3;

export interface BuildWikiBundleOptions {
  /** How many hops of `[[slug]]` links to follow. Clamped to [0, MAX_DEPTH]. */
  depth?: number;
}

export async function buildWikiBundle(
  rootSlug: string,
  opts: BuildWikiBundleOptions = {},
): Promise<WikiBundle> {
  const depth = Math.max(0, Math.min(MAX_DEPTH, opts.depth ?? 1));

  const root = await store.getWikiPageBySlug(rootSlug);
  if (!root) {
    throw new Error(`buildWikiBundle: wiki page not found: ${rootSlug}`);
  }

  // BFS over [[slug]] references. `order` preserves the root-first ordering
  // the import side relies on for picking a canonical "landing" page.
  const seen = new Map<string, WikiPage>();
  seen.set(root.slug, root);
  const order: string[] = [root.slug];

  let frontier: WikiPage[] = [root];
  for (let d = 0; d < depth; d++) {
    const nextFrontier: WikiPage[] = [];
    for (const page of frontier) {
      const targets = extractWikiLinkSlugs(page.content);
      for (const slug of targets) {
        if (seen.has(slug)) continue;
        const linked = await store.getWikiPageBySlug(slug);
        if (!linked) continue; // dangling [[slug]] — skip silently
        seen.set(linked.slug, linked);
        order.push(linked.slug);
        nextFrontier.push(linked);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  const pages = order.map((slug) => seen.get(slug)!).filter(Boolean);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "wiki",
    exportedAt: new Date().toISOString(),
    data: { pages },
  };
}

export async function exportWikiToFile(
  rootSlug: string,
  opts: BuildWikiBundleOptions = {},
): Promise<void> {
  const bundle = await buildWikiBundle(rootSlug, opts);
  const json = JSON.stringify(bundle, null, 2);
  triggerDownload(
    bundleFilename("wiki", bundle.data.pages[0]?.title ?? rootSlug),
    json,
    "application/json",
  );
}
