"use client";

/**
 * Modal that drives the Claude Code session import flow.
 *
 * UX states:
 *   - "needs-permission": browser supports the API but we don't yet
 *     have a directory handle. Show a CTA to pick `~/.claude/projects`.
 *   - "needs-regrant": we have a stored handle but the browser revoked
 *     the permission since the last visit. Show a re-grant button.
 *   - "unsupported": browser lacks the File System Access API. Show
 *     a graceful fallback message (drag-and-drop is a follow-up).
 *   - "ready": handle granted, sessions enumerated. Show the list with
 *     checkboxes + bulk-import button.
 *   - "importing": agent is running. Show per-session progress.
 *   - "done": import finished. Show a summary + close.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  Loader2,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import {
  getStoredHandle,
  ensurePermission,
  isFileSystemAccessSupported,
  pickClaudeProjectsDirectory,
  clearStoredHandle,
} from "@/lib/cc-import/handle-store";
import { enumerateSessions, readSessionById } from "@/lib/cc-import/enumerate";
import { getAllImported } from "@/lib/cc-import/imported-store";
import {
  importCcSessions,
  type ImportProgress,
} from "@/lib/cc-import/import-agent";
import type { CcSessionMeta } from "@/lib/cc-import/types";
import { getSavedSelectedModel } from "@/lib/client-data";
import { isModelReady, resolveModelCredentials } from "@/lib/keys";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";

interface JournalImportModalProps {
  onClose: () => void;
  /** Called after a successful import so the parent can refresh the journal grid. */
  onImported?: (importedSlugs: string[]) => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "needs-permission" }
  | { kind: "needs-regrant" }
  | { kind: "ready"; sessions: CcSessionMeta[] }
  | {
      kind: "importing";
      progress: Map<string, ImportProgress>;
      total: number;
    }
  | {
      kind: "done";
      successCount: number;
      skippedCount: number;
      errorCount: number;
    }
  | { kind: "error"; message: string };

export default function JournalImportModal({
  onClose,
  onImported,
}: JournalImportModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "new">("new");
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);

  // Snapshot of localStorage's imported-sessions map. We refresh it
  // explicitly at the points where it could have changed (initial
  // mount, after picking a folder, after each per-session import) —
  // never in a setState-in-effect, which would cascade renders.
  const [importedMap, setImportedMap] = useState<Record<string, string>>(() =>
    getAllImported(),
  );
  const refreshImportedMap = useCallback(() => {
    setImportedMap(getAllImported());
  }, []);

  /* ---- bootstrap on open ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isFileSystemAccessSupported()) {
        if (!cancelled) setPhase({ kind: "unsupported" });
        return;
      }
      try {
        const stored = await getStoredHandle();
        if (!stored) {
          if (!cancelled) setPhase({ kind: "needs-permission" });
          return;
        }
        const state = await ensurePermission(stored);
        if (state !== "granted") {
          handleRef.current = stored;
          if (!cancelled) setPhase({ kind: "needs-regrant" });
          return;
        }
        handleRef.current = stored;
        const sessions = await enumerateSessions(stored);
        if (!cancelled) setPhase({ kind: "ready", sessions });
      } catch (err) {
        if (!cancelled) {
          setPhase({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to load sessions",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- close on Escape ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase.kind !== "importing") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, phase.kind]);

  /* ---- actions ---- */

  const handlePick = useCallback(async () => {
    try {
      setPhase({ kind: "loading" });
      const handle = await pickClaudeProjectsDirectory();
      if (!handle) {
        setPhase({ kind: "needs-permission" });
        return;
      }
      handleRef.current = handle;
      const sessions = await enumerateSessions(handle);
      setPhase({ kind: "ready", sessions });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not open directory",
      });
    }
  }, []);

  const handleRegrant = useCallback(async () => {
    if (!handleRef.current) {
      setPhase({ kind: "needs-permission" });
      return;
    }
    try {
      const state = await ensurePermission(handleRef.current, { request: true });
      if (state !== "granted") {
        return;
      }
      setPhase({ kind: "loading" });
      const sessions = await enumerateSessions(handleRef.current);
      setPhase({ kind: "ready", sessions });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not access directory",
      });
    }
  }, []);

  const handleRepick = useCallback(async () => {
    await clearStoredHandle();
    handleRef.current = null;
    setSelected(new Set());
    setPhase({ kind: "needs-permission" });
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!handleRef.current) return;
    setPhase({ kind: "loading" });
    try {
      const sessions = await enumerateSessions(handleRef.current);
      setPhase({ kind: "ready", sessions });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not reload sessions",
      });
    }
  }, []);

  const handleImport = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || phase.kind !== "ready") return;
    if (selected.size === 0) return;

    const model = getSavedSelectedModel();
    if (!model || !isModelReady(model)) {
      setPhase({
        kind: "error",
        message: "Add an API key in Settings before importing — the journal agent needs a model to call.",
      });
      return;
    }
    const creds = resolveModelCredentials(model);
    if (!creds) {
      setPhase({
        kind: "error",
        message: "Selected model is missing credentials. Check Settings.",
      });
      return;
    }

    // Read full transcripts for the selected ids.
    const ids = [...selected];
    const parsed = [];
    for (const id of ids) {
      const session = await readSessionById(handle, id);
      if (session) parsed.push(session);
    }

    setPhase({
      kind: "importing",
      progress: new Map(),
      total: parsed.length,
    });

    const result = await importCcSessions({
      sessions: parsed,
      model,
      apiKey: creds.apiKey,
      apiBaseUrl: creds.apiBaseUrl,
      onProgress: (p) => {
        setPhase((prev) => {
          if (prev.kind !== "importing") return prev;
          const next = new Map(prev.progress);
          next.set(p.sessionId, p);
          return { ...prev, progress: next };
        });
        // After each per-session completion, refresh the imported map
        // so the "Imported" badge stays in sync with localStorage.
        if (p.phase === "ok" || p.phase === "skip") {
          refreshImportedMap();
        }
      },
    });

    onImported?.(result.createdSlugs);
    const skipped = Math.max(
      0,
      result.importedSessionIds.length - result.createdSlugs.length,
    );
    setPhase({
      kind: "done",
      successCount: result.createdSlugs.length,
      skippedCount: skipped,
      errorCount: result.errors.length,
    });
    refreshImportedMap();
  }, [phase, selected, onImported, refreshImportedMap]);

  /* ---- derived ---- */

  const visibleSessions = useMemo(() => {
    if (phase.kind !== "ready") return [];
    if (filter === "all") return phase.sessions;
    return phase.sessions.filter((s) => !(s.sessionId in importedMap));
  }, [phase, filter, importedMap]);

  const newCount = useMemo(() => {
    if (phase.kind !== "ready") return 0;
    return phase.sessions.filter((s) => !(s.sessionId in importedMap)).length;
  }, [phase, importedMap]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = visibleSessions.every((s) => next.has(s.sessionId));
      if (allSelected) {
        for (const s of visibleSessions) next.delete(s.sessionId);
      } else {
        for (const s of visibleSessions) next.add(s.sessionId);
      }
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-8"
      onClick={() => {
        if (phase.kind !== "importing") onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="shrink-0 border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/8">
              <Terminal className="size-[14px] text-primary/60" strokeWidth={1.8} />
            </div>
            <div className="flex flex-col">
              <h2 className="text-[13px] font-semibold text-foreground">
                Import from Claude Code
              </h2>
              <p className="text-[11px] text-muted-foreground/70">
                Turn your CLI sessions into journal entries.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={phase.kind === "importing"}
              className="ml-auto rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {phase.kind === "loading" ? (
            <CenteredState>
              <Loader2 className="size-5 animate-spin text-muted-foreground/60" />
              <p className="mt-3 text-[12px] text-muted-foreground/70">Loading…</p>
            </CenteredState>
          ) : phase.kind === "unsupported" ? (
            <CenteredState>
              <AlertTriangle className="size-6 text-amber-500/80" />
              <p className="mt-3 max-w-sm text-center text-[12.5px] text-muted-foreground">
                Your browser doesn&apos;t support the File System Access API. Use a Chromium-based browser (Chrome, Edge, Brave, Arc) to import sessions directly.
              </p>
            </CenteredState>
          ) : phase.kind === "needs-permission" ? (
            <CenteredState>
              <FolderOpen className="size-6 text-primary/70" />
              <p className="mt-3 max-w-sm text-center text-[12.5px] text-muted-foreground">
                Pick your <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/.claude/projects</code> directory. Artifact only reads JSONL session files; nothing leaves your machine until you choose what to import.
              </p>
              <button
                type="button"
                onClick={handlePick}
                className="mt-5 rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Choose folder
              </button>
            </CenteredState>
          ) : phase.kind === "needs-regrant" ? (
            <CenteredState>
              <FolderOpen className="size-6 text-primary/70" />
              <p className="mt-3 max-w-sm text-center text-[12.5px] text-muted-foreground">
                Re-grant access to your previously chosen Claude Code directory.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={handleRegrant}
                  className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  Re-grant access
                </button>
                <button
                  type="button"
                  onClick={handleRepick}
                  className="rounded-md border border-border bg-card px-4 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Pick a different folder
                </button>
              </div>
            </CenteredState>
          ) : phase.kind === "error" ? (
            <CenteredState>
              <AlertTriangle className="size-6 text-amber-500/80" />
              <p className="mt-3 max-w-sm text-center text-[12.5px] text-muted-foreground">
                {phase.message}
              </p>
              <button
                type="button"
                onClick={() => setPhase({ kind: "loading" })}
                className="mt-5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
              >
                Try again
              </button>
            </CenteredState>
          ) : phase.kind === "ready" ? (
            <ReadyView
              sessions={visibleSessions}
              allSessions={phase.sessions}
              importedMap={importedMap}
              selected={selected}
              filter={filter}
              newCount={newCount}
              onToggleOne={toggleOne}
              onToggleAll={toggleAllVisible}
              onSetFilter={setFilter}
              onRefresh={handleRefresh}
              onRepick={handleRepick}
            />
          ) : phase.kind === "importing" ? (
            <ImportingView phase={phase} />
          ) : (
            <DoneView phase={phase} onClose={onClose} />
          )}
        </div>

        {phase.kind === "ready" ? (
          <footer className="shrink-0 border-t border-border/60 bg-muted/30 px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground/70">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={handleImport}
                className="rounded-md bg-primary px-4 py-1.5 text-[12px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/60"
              >
                Import {selected.size > 0 ? `${selected.size} ` : ""}
                {selected.size === 1 ? "session" : "sessions"}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subviews                                                           */
/* ------------------------------------------------------------------ */

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      {children}
    </div>
  );
}

interface ReadyViewProps {
  sessions: CcSessionMeta[];
  allSessions: CcSessionMeta[];
  importedMap: Record<string, string>;
  selected: Set<string>;
  filter: "all" | "new";
  newCount: number;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onSetFilter: (f: "all" | "new") => void;
  onRefresh: () => void;
  onRepick: () => void;
}

function ReadyView({
  sessions,
  allSessions,
  importedMap,
  selected,
  filter,
  newCount,
  onToggleOne,
  onToggleAll,
  onSetFilter,
  onRefresh,
  onRepick,
}: ReadyViewProps) {
  const allVisibleSelected =
    sessions.length > 0 && sessions.every((s) => selected.has(s.sessionId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-6 py-3">
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => onSetFilter("new")}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              filter === "new"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            New ({newCount})
          </button>
          <button
            type="button"
            onClick={() => onSetFilter("all")}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              filter === "all"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All ({allSessions.length})
          </button>
        </div>

        {sessions.length > 0 ? (
          <button
            type="button"
            onClick={onToggleAll}
            className="rounded-md border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {allVisibleSelected ? "Clear" : "Select all"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-md p-1.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          aria-label="Refresh"
        >
          <RefreshCw className="size-[13px]" />
        </button>
        <button
          type="button"
          onClick={onRepick}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          Change folder
        </button>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 py-10 text-center text-[12px] text-muted-foreground/70">
            {filter === "new"
              ? "Nothing new to import — every session in this folder is already in your journal."
              : "No Claude Code sessions found in this folder."}
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const checked = selected.has(s.sessionId);
              const alreadyImported = s.sessionId in importedMap;
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => onToggleOne(s.sessionId)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors",
                      checked
                        ? "border-primary/30 bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-[2px] flex size-[14px] shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/80 bg-background",
                      )}
                    >
                      {checked ? <Check className="size-[10px]" strokeWidth={3} /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-foreground">
                          {s.summary || s.firstUserMessage || s.sessionId.slice(0, 8)}
                        </span>
                        {alreadyImported ? (
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                            Imported
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                        <span className="truncate" title={s.projectPath}>
                          {s.projectLabel || s.projectPath}
                        </span>
                        <span>·</span>
                        <span>{s.turnCount} turns</span>
                        {s.lastActivityAt ? (
                          <>
                            <span>·</span>
                            <span>{formatRelative(s.lastActivityAt)}</span>
                          </>
                        ) : null}
                      </div>
                      {s.firstUserMessage && s.firstUserMessage !== s.summary ? (
                        <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground/80">
                          {s.firstUserMessage}
                        </p>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ImportingViewProps {
  phase: Extract<Phase, { kind: "importing" }>;
}

function ImportingView({ phase }: ImportingViewProps) {
  const entries = [...phase.progress.values()].sort((a, b) => a.index - b.index);
  const completed = entries.filter((e) => e.phase !== "start").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
      <div className="mb-3 flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-primary/70" />
        <span className="text-[12px] font-medium text-foreground">
          Importing {completed} / {phase.total} sessions…
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60 bg-card/30 px-3 py-2">
        {entries.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70">Starting…</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.sessionId} className="flex items-center gap-2 text-[11.5px]">
                {e.phase === "start" ? (
                  <CircleDashed className="size-[13px] animate-spin text-muted-foreground/70" />
                ) : e.phase === "ok" ? (
                  <CheckCircle2 className="size-[13px] text-emerald-600" />
                ) : e.phase === "skip" ? (
                  <CheckCircle2 className="size-[13px] text-muted-foreground/50" />
                ) : (
                  <AlertTriangle className="size-[13px] text-amber-500" />
                )}
                <span className="truncate text-muted-foreground">
                  {e.sessionId.slice(0, 8)} —{" "}
                  {e.phase === "start"
                    ? "running agent"
                    : e.phase === "ok"
                      ? "added to journal"
                      : e.phase === "skip"
                        ? e.message ?? "skipped"
                        : (e.message ?? "failed")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface DoneViewProps {
  phase: Extract<Phase, { kind: "done" }>;
  onClose: () => void;
}

function DoneView({ phase, onClose }: DoneViewProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <CheckCircle2 className="size-7 text-emerald-600" />
      <p className="mt-3 text-[13px] font-semibold text-foreground">Import complete</p>
      <p className="mt-1 text-center text-[12px] text-muted-foreground">
        {phase.successCount > 0
          ? `Added ${phase.successCount} ${phase.successCount === 1 ? "entry" : "entries"} to your journal.`
          : "No new entries were created."}
        {phase.errorCount > 0
          ? ` ${phase.errorCount} ${phase.errorCount === 1 ? "session" : "sessions"} failed.`
          : ""}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        Done
      </button>
    </div>
  );
}
