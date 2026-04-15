/**
 * Walk a `~/.claude/projects` directory handle and surface every
 * session JSONL file as a `CcSessionMeta` row for the import browser.
 *
 * Layout we expect:
 *
 *   <root>/
 *     -Users-me-code-artifact/
 *       0a1b2c3d-….jsonl
 *       9f8e7d6c-….jsonl
 *     -Users-me-personal-notes/
 *       …
 *
 * Each subdirectory is a CC project (directory name is the
 * dash-encoded cwd). Each `.jsonl` file inside is one session. We
 * read every file once for the cheap pre-scan — CC sessions are
 * usually well under a megabyte each, so this is acceptable for the
 * one-shot enumeration. If perf becomes a concern we can cache by
 * `(name, lastModified)` later.
 *
 * Errors on individual files are swallowed: a single malformed
 * session shouldn't break the whole listing.
 */

import { extractMeta, parseSession } from "./parser";
import type { CcSessionMeta, ParsedCcSession } from "./types";

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface EnumerateOptions {
  /** Hard cap on number of sessions returned. Defaults to 500. */
  maxSessions?: number;
}

/** Walk the directory handle and return one `CcSessionMeta` per session, sorted newest-first. */
export async function enumerateSessions(
  root: FileSystemDirectoryHandle,
  opts: EnumerateOptions = {},
): Promise<CcSessionMeta[]> {
  const max = opts.maxSessions ?? 500;
  const out: CcSessionMeta[] = [];

  // Two supported layouts:
  //   1. User picked `~/.claude/projects` — iterate sub-dirs for jsonls.
  //   2. User picked a single project dir — iterate its jsonls directly.
  // We handle both in one pass by also collecting any jsonls found at
  // the root level.
  for await (const entry of iterEntries(root)) {
    if (entry.kind === "directory") {
      const projectDir = entry as FileSystemDirectoryHandle;
      for await (const fileEntry of iterEntries(projectDir)) {
        if (fileEntry.kind !== "file") continue;
        if (!fileEntry.name.toLowerCase().endsWith(".jsonl")) continue;
        try {
          const meta = await readMeta(
            fileEntry as FileSystemFileHandle,
            projectDir.name,
          );
          if (meta) out.push(meta);
          if (out.length >= max) break;
        } catch {
          /* skip broken file */
        }
      }
    } else if (entry.kind === "file") {
      if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;
      try {
        const meta = await readMeta(
          entry as FileSystemFileHandle,
          root.name,
        );
        if (meta) out.push(meta);
      } catch {
        /* skip broken file */
      }
    }
    if (out.length >= max) break;
  }

  out.sort((a, b) => {
    const at = a.lastActivityAt ?? "";
    const bt = b.lastActivityAt ?? "";
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
  return out;
}

/** Read and fully parse a single session by id (sessionId is the filename stem). */
export async function readSessionById(
  root: FileSystemDirectoryHandle,
  sessionId: string,
): Promise<ParsedCcSession | null> {
  const matchInDir = async (
    dir: FileSystemDirectoryHandle,
  ): Promise<ParsedCcSession | null> => {
    for await (const fileEntry of iterEntries(dir)) {
      if (fileEntry.kind !== "file") continue;
      const stem = fileEntry.name.replace(/\.jsonl$/i, "");
      if (stem !== sessionId) continue;
      const file = await (fileEntry as FileSystemFileHandle).getFile();
      const text = await file.text();
      return parseSession({
        fileName: fileEntry.name,
        parentDirName: dir.name,
        byteSize: file.size,
        text,
      });
    }
    return null;
  };

  // Root-level files first (project-folder pick), then one level deeper
  // (projects-root pick).
  const rootHit = await matchInDir(root);
  if (rootHit) return rootHit;

  for await (const entry of iterEntries(root)) {
    if (entry.kind !== "directory") continue;
    const hit = await matchInDir(entry as FileSystemDirectoryHandle);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

/**
 * Async iterator over a directory's entries. Wraps the standard
 * `entries()` async iterator — exists purely to centralize the
 * `unknown`→typed casting that the dom lib doesn't yet ship.
 */
async function* iterEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterableIterator<FileSystemHandle> {
  const d = dir as unknown as {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  for await (const [, handle] of d.entries()) {
    yield handle;
  }
}

async function readMeta(
  fileHandle: FileSystemFileHandle,
  parentDirName: string,
): Promise<CcSessionMeta | null> {
  const file = await fileHandle.getFile();
  // Empty files are noise — skip.
  if (file.size === 0) return null;
  const text = await file.text();
  return extractMeta({
    fileName: fileHandle.name,
    parentDirName,
    byteSize: file.size,
    text,
  });
}
