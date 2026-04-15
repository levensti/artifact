/**
 * Persistent storage for the user's `~/.claude/projects`
 * FileSystemDirectoryHandle.
 *
 * `FileSystemDirectoryHandle` instances are structured-cloneable, so
 * we can stash them inside IndexedDB and reuse them across page
 * loads — Chromium remembers the user's grant as long as the handle
 * is alive in storage. We use a tiny dedicated IDB database (not the
 * main Dexie store) so we don't have to bump the Artifact schema or
 * coexist with Dexie's own version handling.
 *
 * Permission lifecycle:
 *   1. First visit: caller invokes `pickClaudeProjectsDirectory()`,
 *      which prompts the user via `showDirectoryPicker()` and stores
 *      the resulting handle.
 *   2. Subsequent visits: caller invokes `getStoredHandle()` and then
 *      `ensurePermission(handle, "read")` to silently re-acquire
 *      permission. If it returns `"prompt"`, the caller can re-ask.
 */

const DB_NAME = "artifact-cc-import";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "claude-projects-dir";

/* ------------------------------------------------------------------ */
/*  Feature detection                                                  */
/* ------------------------------------------------------------------ */

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker === "function";
}

/* ------------------------------------------------------------------ */
/*  IDB plumbing                                                       */
/* ------------------------------------------------------------------ */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Show the directory picker and persist the resulting handle. Returns
 * the handle on success, or null if the user dismissed the picker.
 *
 * The `id` argument scopes the picker's "remembered location" to this
 * feature, so reopening it returns the user to the same parent
 * directory.
 */
export async function pickClaudeProjectsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "Your browser doesn't support the File System Access API. Use a Chromium-based browser, or drag a session file into the journal instead.",
    );
  }
  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (opts?: {
          id?: string;
          mode?: "read" | "readwrite";
          startIn?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    const handle = await picker({
      id: "artifact-claude-projects",
      mode: "read",
      startIn: "documents",
    });
    await idbPut(HANDLE_KEY, handle);
    return handle;
  } catch (err) {
    // AbortError = user dismissed the picker. Treat as "no selection".
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Read the previously-stored directory handle, or null if none. */
export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    return await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  } catch {
    return null;
  }
}

/** Forget the stored handle (used when the user wants to re-pick). */
export async function clearStoredHandle(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await idbDelete(HANDLE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Check or re-acquire permission on a previously-stored handle.
 * Returns "granted", "denied", or "prompt". If `request` is true and
 * the current state is "prompt", we synchronously call
 * `requestPermission` — note this requires a user gesture, so callers
 * should only request on click handlers, not on page load.
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  opts: { request?: boolean } = {},
): Promise<PermissionState> {
  // The TypeScript dom lib doesn't yet ship typings for these methods
  // on FileSystemHandle in all targets, so we narrow manually.
  const h = handle as unknown as {
    queryPermission: (d: { mode: "read" }) => Promise<PermissionState>;
    requestPermission: (d: { mode: "read" }) => Promise<PermissionState>;
  };
  let state = await h.queryPermission({ mode: "read" });
  if (state === "prompt" && opts.request) {
    state = await h.requestPermission({ mode: "read" });
  }
  return state;
}
