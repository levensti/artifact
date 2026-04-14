/**
 * Ambient wiki ingest status tracker.
 *
 * Lightweight pub/sub so UI surfaces (sidebar pill, status chip, toast)
 * can show a subtle "background agent is working" cue without each
 * ingest site needing to own its own React state.
 *
 * Usage:
 *   const token = beginWikiIngest({ kind: "paper", label: paperTitle });
 *   try { await runWikiIngest(...); }
 *   finally { endWikiIngest(token); }
 *
 * Subscribe in a component with:
 *   const active = useSyncExternalStore(
 *     subscribeWikiStatus,
 *     getWikiIngestSnapshot,
 *     getWikiIngestSnapshot,
 *   );
 */

export const WIKI_INGEST_UPDATED_EVENT = "paper-copilot-wiki-ingest-updated";

export type WikiIngestKind = "paper" | "chat-extract" | "lint" | "other";

export interface WikiIngestTask {
  id: number;
  kind: WikiIngestKind;
  /** Short human label: paper title, "Chat extract", etc. */
  label: string;
  startedAt: number;
}

let nextId = 1;
const active = new Map<number, WikiIngestTask>();
let snapshot: WikiIngestTask[] = [];

function recomputeSnapshot(): void {
  // Return a stable-identity snapshot so useSyncExternalStore works.
  snapshot = Array.from(active.values()).sort((a, b) => a.id - b.id);
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WIKI_INGEST_UPDATED_EVENT));
}

/** Mark a background wiki operation as started. Returns a token used to end it. */
export function beginWikiIngest(opts: {
  kind: WikiIngestKind;
  label: string;
}): number {
  const id = nextId++;
  active.set(id, {
    id,
    kind: opts.kind,
    label: opts.label,
    startedAt: Date.now(),
  });
  recomputeSnapshot();
  notify();
  return id;
}

/** Mark a background wiki operation as finished. Safe to call with unknown ids. */
export function endWikiIngest(token: number): void {
  if (!active.has(token)) return;
  active.delete(token);
  recomputeSnapshot();
  notify();
}

/** Synchronous snapshot for useSyncExternalStore. Stable across no-op calls. */
export function getWikiIngestSnapshot(): WikiIngestTask[] {
  return snapshot;
}

/** useSyncExternalStore subscribe function. */
export function subscribeWikiStatus(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WIKI_INGEST_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(WIKI_INGEST_UPDATED_EVENT, onChange);
}

/** Convenience: how many ingests are currently running? */
export function getActiveIngestCount(): number {
  return snapshot.length;
}
