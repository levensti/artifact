/**
 * Ambient wiki ingest status tracker.
 *
 * Lightweight pub/sub so UI surfaces (sidebar pill, status chip, toast)
 * can show a subtle "background agent is working" cue without each
 * ingest site needing to own its own React state.
 *
 * Usage:
 *   const token = beginWikiIngest({ kind: "journal", label: "Journaling" });
 *   try { await runJournalAgent(...); }
 *   finally { endWikiIngest(token); }
 *
 * Subscribe in a component with:
 *   const active = useSyncExternalStore(
 *     subscribeWikiStatus,
 *     getWikiIngestSnapshot,
 *     getWikiIngestSnapshot,
 *   );
 */

const WIKI_INGEST_UPDATED_EVENT = "paper-copilot-wiki-ingest-updated";

export type WikiIngestKind = "journal" | "other";

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
let lastError: string | null = null;

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

/**
 * Record a recent ambient-ingest failure so the sidebar can surface it.
 * Pass `null` to dismiss. Errors don't block future ingests.
 */
export function reportWikiIngestError(message: string | null): void {
  lastError = message;
  notify();
}

/** Snapshot of the most recent ingest error, or null. */
export function getWikiIngestError(): string | null {
  return lastError;
}
