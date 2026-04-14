/**
 * Client-side loader for the user-editable wiki schema document
 * (`docs/wiki-schema.md`). Cached in memory for the lifetime of the
 * page — edits to the .md file are picked up on the next page load.
 */

let cached: string | null = null;
let inflight: Promise<string> | null = null;

const FALLBACK = `## Page types
- concept: general idea
- method: technique or algorithm
- entity: specific model / dataset / benchmark
- paper: specific paper summary

## Rules
- Length target: 150-400 words per page.
- Cross-reference liberally with [[slug]] links.
- When extending an existing page, set update: true and emit the full rewritten content.`;

export async function loadWikiSchema(): Promise<string> {
  if (cached !== null) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/wiki-schema", { cache: "no-store" });
      if (!res.ok) {
        cached = FALLBACK;
        return FALLBACK;
      }
      const txt = await res.text();
      cached = txt.trim() || FALLBACK;
      return cached;
    } catch {
      cached = FALLBACK;
      return FALLBACK;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
