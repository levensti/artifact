/**
 * Tracks which Claude Code session UUIDs the user has already
 * imported into their journal, so we can dedupe re-imports and badge
 * "new since last sync" rows in the browser.
 *
 * Persisted in localStorage as a JSON map of `sessionId → ISO date`
 * (the import timestamp). Tiny payload — even a thousand sessions is
 * well under 100 KB.
 */

const KEY = "artifact:cc-import:imported";

type ImportedMap = Record<string, string>;

function readMap(): ImportedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ImportedMap;
  } catch {
    /* fall through */
  }
  return {};
}

function writeMap(map: ImportedMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

export function isImported(sessionId: string): boolean {
  return sessionId in readMap();
}

export function getImportedAt(sessionId: string): string | null {
  return readMap()[sessionId] ?? null;
}

export function markImported(sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  const map = readMap();
  const now = new Date().toISOString();
  for (const id of sessionIds) map[id] = now;
  writeMap(map);
}

export function getAllImported(): ImportedMap {
  return readMap();
}

export function clearImported(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
