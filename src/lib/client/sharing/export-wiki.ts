/**
 * Wiki (journal) bundle export. The server walks `[[slug]]` references
 * to the requested depth and returns the full bundle.
 *
 * Depth 0 = just the root page. Depth 1 (default) = root + pages directly
 * linked from it. Capped at 3 hops on both ends.
 */

import { apiFetch } from "@/lib/client/api";
import { bundleFilename, type WikiBundle } from "./bundle-format";
import { triggerDownload } from "./download";

export interface BuildWikiBundleOptions {
  /** Depth of `[[slug]]` traversal. Server clamps to [0, 3]. */
  depth?: number;
}

export async function buildWikiBundle(
  rootSlug: string,
  opts: BuildWikiBundleOptions = {},
): Promise<WikiBundle> {
  const params = new URLSearchParams();
  if (opts.depth !== undefined) params.set("depth", String(opts.depth));
  const qs = params.toString();
  const url = `/api/export/wiki/${encodeURIComponent(rootSlug)}${qs ? `?${qs}` : ""}`;
  const { bundle } = await apiFetch<{ bundle: WikiBundle }>(url);
  return bundle;
}

export async function exportWikiToFile(
  rootSlug: string,
  opts: BuildWikiBundleOptions = {},
): Promise<void> {
  const bundle = await buildWikiBundle(rootSlug, opts);
  triggerDownload(
    bundleFilename("wiki", bundle.data.pages[0]?.title ?? rootSlug),
    JSON.stringify(bundle, null, 2),
    "application/json",
  );
}
