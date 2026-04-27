"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  FileDown,
  FilePen,
  Plus,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import JournalCard, { type JournalEntry } from "@/components/journal-card";
import JournalEntryModal from "@/components/journal-entry-modal";
import JournalImportModal from "@/components/journal-import-modal";
import JournalComposerModal from "@/components/journal-composer-modal";
import ImportBundleDialog from "@/components/import-bundle-dialog";
import {
  getSavedSelectedModel,
  hydrateClientStore,
  loadWikiPages,
  saveWikiPage,
} from "@/lib/client-data";
import type { WikiPage } from "@/lib/wiki";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
import { localDateKey } from "@/lib/date-keys";
import { buildSessionSlug, uniquifySlug } from "@/lib/journal-entry-builder";
import { enumerateSessions } from "@/lib/cc-import/enumerate";
import {
  ensurePermission,
  getStoredHandle,
  isFileSystemAccessSupported,
} from "@/lib/cc-import/handle-store";
import { getAllImported } from "@/lib/cc-import/imported-store";

function dateFromSessionSlug(slug: string): Date | null {
  // Matches both `session-YYYY-MM-DD` and topic-sharded variants like
  // `session-YYYY-MM-DD-rlhf-basics` that the journal agent can emit.
  const m = /^session-(\d{4})-(\d{2})-(\d{2})(?:-|$)/.exec(slug);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function relativeDayLabel(d: Date): string {
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfThat.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function dateFromDigestSlug(slug: string): Date | null {
  const m = /^digest-week-(\d{4})-w(\d{2})$/.exec(slug);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dayOfWeek = simple.getDay() || 7;
  simple.setDate(simple.getDate() - dayOfWeek + 1);
  return simple;
}

export default function JournalPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Loading…
          </div>
        </DashboardLayout>
      }
    >
      <JournalPageInner />
    </Suspense>
  );
}

function JournalPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [bundleImportOpen, setBundleImportOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [ccNewCount, setCcNewCount] = useState(0);
  const selectedSlug = searchParams.get("page");

  const refreshPages = useCallback(async () => {
    const list = await loadWikiPages();
    setPages(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await hydrateClientStore();
        if (cancelled) return;
        await refreshPages();
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load wiki.",
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    const handler = () =>
      void refreshPages().catch(() => {
        /* ignore — event will re-fire */
      });
    window.addEventListener(WIKI_UPDATED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(WIKI_UPDATED_EVENT, handler);
    };
  }, [refreshPages, reloadTick]);

  // Ambient check: if the user has previously granted access to their
  // ~/.claude/projects directory, count how many sessions are not yet
  // imported so we can badge the toolbar Import button.
  const refreshCcNewCount = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      setCcNewCount(0);
      return;
    }
    try {
      const handle = await getStoredHandle();
      if (!handle) {
        setCcNewCount(0);
        return;
      }
      // queryPermission only — never request on background load (no
      // user gesture). The badge silently disappears if the browser
      // dropped permission.
      const state = await ensurePermission(handle);
      if (state !== "granted") {
        setCcNewCount(0);
        return;
      }
      const sessions = await enumerateSessions(handle);
      const imported = getAllImported();
      let n = 0;
      for (const s of sessions) if (!(s.sessionId in imported)) n++;
      setCcNewCount(n);
    } catch {
      setCcNewCount(0);
    }
  }, []);

  useEffect(() => {
    void refreshCcNewCount();
  }, [refreshCcNewCount, reloadTick]);

  const openPage = useCallback(
    (slug: string) => {
      router.push(`/journal?page=${encodeURIComponent(slug)}`, {
        scroll: false,
      });
    },
    [router],
  );

  const closeModal = useCallback(() => {
    router.replace("/journal", { scroll: false });
  }, [router]);

  const handleNewBlankEntry = useCallback(async () => {
    const existing = await loadWikiPages();
    const slugs = new Set(existing.map((p) => p.slug));
    const slug = uniquifySlug(buildSessionSlug("Untitled"), slugs);
    await saveWikiPage({
      slug,
      title: "Untitled",
      content: "",
      pageType: "session",
    });
    void refreshPages();
    router.push(`/journal?page=${encodeURIComponent(slug)}`, {
      scroll: false,
    });
  }, [refreshPages, router]);

  const journalEntries = useMemo<JournalEntry[]>(() => {
    const entries: JournalEntry[] = [];
    for (const p of pages) {
      if (p.pageType === "session") {
        const date = dateFromSessionSlug(p.slug) ?? new Date(p.updatedAt);
        entries.push({ kind: "session", page: p, date });
      } else if (p.pageType === "digest") {
        const date = dateFromDigestSlug(p.slug) ?? new Date(p.updatedAt);
        entries.push({ kind: "digest", page: p, date });
      }
    }
    entries.sort((a, b) => b.date.getTime() - a.date.getTime());
    return entries;
  }, [pages]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return journalEntries;
    return journalEntries.filter(
      (e) =>
        e.page.title.toLowerCase().includes(q) ||
        e.page.content.toLowerCase().includes(q),
    );
  }, [journalEntries, search]);

  // Group entries by last-updated date so the grid has visible day
  // sections rather than a fully flat masonry. We sort entries by
  // updatedAt (newest first) inside each section so a streaming entry
  // bubbles to the top as it changes.
  const groupedEntries = useMemo(() => {
    const sorted = [...filteredEntries].sort((a, b) => {
      const ua = new Date(a.page.updatedAt).getTime();
      const ub = new Date(b.page.updatedAt).getTime();
      return ub - ua;
    });
    const groups: { key: string; label: string; entries: typeof filteredEntries }[] = [];
    const seen = new Map<string, number>();
    for (const e of sorted) {
      const d = new Date(e.page.updatedAt);
      const key = localDateKey(d);
      const idx = seen.get(key);
      if (idx === undefined) {
        seen.set(key, groups.length);
        groups.push({ key, label: relativeDayLabel(d), entries: [e] });
      } else {
        groups[idx].entries.push(e);
      }
    }
    return groups;
  }, [filteredEntries]);

  const selectedPage = useMemo(
    () => pages.find((p) => p.slug === selectedSlug) ?? null,
    [pages, selectedSlug],
  );

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  if (loadError && pages.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-md space-y-4 text-center">
            <AlertTriangle className="mx-auto size-8 text-warning" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-foreground">
                Could not load the knowledge base
              </h1>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReady(false);
                setReloadTick((t) => t + 1);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Retry
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const hasAnyContent = journalEntries.length > 0;

  if (!hasAnyContent) {
    const todayLabel = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    return (
      <DashboardLayout>
        <div
          className="flex h-full flex-col overflow-y-auto"
          style={{ background: "var(--reader-mat)" }}
        >
          <div className="mx-auto w-full max-w-160 px-6 pt-[min(14vh,120px)] pb-16">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground">
                Journal
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                A running log of what you read and build. Entries appear
                automatically as you work.
              </p>
            </div>

            {/* Ghost timeline — shows the shape of what will fill in */}
            <div className="relative">
              {/* Vertical timeline spine */}
              <div className="absolute left-3.75 top-2 bottom-6 w-px bg-border/50" />

              {/* Today — the active slot */}
              <div className="relative mb-6 pl-10">
                <div className="absolute left-2.75 top-1.75 size-2.25 rounded-full border-2 border-primary/50 bg-background" />
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/60">
                  Today &middot; {todayLabel}
                </p>
                <div className="mt-3 rounded-xl border border-dashed border-border bg-card/50 px-5 py-5">
                  <p className="text-[13px] font-medium text-foreground/70">
                    Your first entry will appear here
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground/60">
                    Save a chat from a paper review, write a new entry from a
                    natural-language prompt, or import a coding session.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setComposerOpen(true)}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11.5px] font-medium text-primary transition-all duration-200 hover:bg-primary/15"
                    >
                      <Plus className="size-3" strokeWidth={2.25} />
                      New entry
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportOpen(true)}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-[11.5px] font-medium text-foreground/80 transition-all duration-200 hover:border-primary/25 hover:shadow-(--shadow-primary) hover:text-foreground"
                    >
                      <Terminal className="size-3 text-primary/50 transition-colors group-hover:text-primary/70" />
                      Import from Claude Code
                    </button>
                    <button
                      type="button"
                      onClick={() => setBundleImportOpen(true)}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-[11.5px] font-medium text-foreground/80 transition-all duration-200 hover:border-primary/25 hover:shadow-(--shadow-primary) hover:text-foreground"
                    >
                      <FileDown className="size-3 text-primary/50 transition-colors group-hover:text-primary/70" />
                      Open a shared journal
                    </button>
                  </div>
                </div>
              </div>

              {/* Ghost: upcoming week digest */}
              <div className="relative mb-6 pl-10 opacity-30">
                <div className="absolute left-3 top-1.75 size-1.75 rounded-full bg-muted-foreground/30" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                  This week
                </p>
                <div className="mt-2.5 h-13 rounded-lg border border-dashed border-border/60 bg-card/30" />
              </div>

              {/* Ghost: previous days */}
              <div className="relative pl-10 opacity-15">
                <div className="absolute left-3 top-1.75 size-1.75 rounded-full bg-muted-foreground/30" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                  Earlier
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div className="h-11 rounded-lg border border-dashed border-border/60 bg-card/30" />
                  <div className="h-11 rounded-lg border border-dashed border-border/60 bg-card/30" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {importOpen ? (
          <JournalImportModal
            onClose={() => {
              setImportOpen(false);
              void refreshCcNewCount();
              void refreshPages();
              setReloadTick((t) => t + 1);
            }}
          />
        ) : null}
        <ImportBundleDialog
          open={bundleImportOpen}
          mode="journal"
          onClose={() => {
            setBundleImportOpen(false);
            void refreshPages();
          }}
        />
        {composerOpen ? (
          <JournalComposerModal
            selectedModel={getSavedSelectedModel()}
            onClose={() => setComposerOpen(false)}
            onCreated={(slug) => {
              void refreshPages();
              router.push(`/journal?page=${encodeURIComponent(slug)}`, {
                scroll: false,
              });
            }}
          />
        ) : null}
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div
        className="flex h-full flex-col overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
        <div className="mx-auto w-full max-w-295 px-5 pb-16 pt-5 sm:px-8">
          {/* Header + toolbar row */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <header>
              <div className="flex items-baseline gap-2">
                <h1 className="text-[18px] font-bold leading-none tracking-[-0.025em] text-foreground">
                  Journal
                </h1>
                <span className="text-[11px] tabular-nums text-muted-foreground/50">
                  {journalEntries.length}{" "}
                  {journalEntries.length === 1 ? "entry" : "entries"}
                </span>
              </div>
            </header>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-1.5 transition-colors focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10">
                <Search className="size-3 shrink-0 text-muted-foreground/45" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-35 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/45 focus:outline-none sm:w-45"
                />
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNewMenuOpen(!newMenuOpen)}
                  className="relative flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <Plus className="size-3" strokeWidth={2.25} />
                  New entry
                  <ChevronDown className="size-3 text-primary/70" />
                  {ccNewCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm">
                      {ccNewCount > 99 ? "99+" : ccNewCount}
                    </span>
                  ) : null}
                </button>
                {newMenuOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setNewMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-border bg-card p-1 shadow-md animate-in fade-in slide-in-from-top-1 duration-150">
                      <button
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          void handleNewBlankEntry();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
                      >
                        <FilePen className="size-3.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Blank entry</p>
                          <p className="text-[10px] text-muted-foreground/60">
                            Start with an empty page
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          setComposerOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
                      >
                        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Draft from a prompt</p>
                          <p className="text-[10px] text-muted-foreground/60">
                            AI summarizes recent activity
                          </p>
                        </div>
                      </button>
                      <div className="my-1 h-px bg-border/60" />
                      <button
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          setImportOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
                      >
                        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="font-medium">From Claude Code</p>
                          <p className="text-[10px] text-muted-foreground/60">
                            Import recent conversations
                          </p>
                        </div>
                        {ccNewCount > 0 ? (
                          <span className="ml-auto shrink-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">
                            {ccNewCount > 99 ? "99+" : ccNewCount}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          setBundleImportOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
                      >
                        <FileDown className="size-3.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="font-medium">From shared file</p>
                          <p className="text-[10px] text-muted-foreground/60">
                            Open a journal bundle
                          </p>
                        </div>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Grouped grid */}
          {filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-[12.5px] text-muted-foreground/70">
              No entries match &ldquo;{search}&rdquo;.
            </div>
          ) : (
            <div className="space-y-7">
              {groupedEntries.map((group) => (
                <section key={group.key}>
                  <h2 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground/55">
                    {group.label}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                    {group.entries.map((entry) => (
                      <div key={entry.page.id} id={`card-${entry.page.slug}`}>
                        <JournalCard entry={entry} onOpen={openPage} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {importOpen ? (
        <JournalImportModal
          onClose={() => {
            setImportOpen(false);
            void refreshCcNewCount();
            void refreshPages();
          }}
        />
      ) : null}

      {selectedPage ? (
        <JournalEntryModal page={selectedPage} onClose={closeModal} />
      ) : selectedSlug ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={closeModal}
        >
          <div
            className="max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[14px] font-semibold text-foreground">
              Not in the journal yet
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {selectedSlug}
              </code>{" "}
              isn&apos;t a journal entry.
            </p>
            <button
              type="button"
              onClick={closeModal}
              className="mt-4 rounded-md bg-sidebar-accent px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <ImportBundleDialog
        open={bundleImportOpen}
        mode="journal"
        onClose={() => {
          setBundleImportOpen(false);
          void refreshPages();
        }}
      />

      {composerOpen ? (
        <JournalComposerModal
          selectedModel={getSavedSelectedModel()}
          onClose={() => setComposerOpen(false)}
          onCreated={(slug) => {
            void refreshPages();
            router.push(`/journal?page=${encodeURIComponent(slug)}`, {
              scroll: false,
            });
          }}
        />
      ) : null}
    </DashboardLayout>
  );
}
