"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, Plus, Search } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import PageHeader from "@/components/page-header";
import JournalCard, { type JournalEntry } from "@/components/journal-card";
import JournalEntryModal from "@/components/journal-entry-modal";
import JournalComposerModal from "@/components/journal-composer-modal";
import {
  getSavedSelectedModel,
  hydrateClientStore,
  loadWikiPages,
  saveWikiPage,
} from "@/lib/client-data";
import type { WikiPage } from "@/lib/wiki";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
import { buildSessionSlug, uniquifySlug } from "@/lib/journal-entry-builder";

function dateFromSessionSlug(slug: string): Date | null {
  // Matches both `session-YYYY-MM-DD` and topic-sharded variants like
  // `session-YYYY-MM-DD-rlhf-basics` that the journal agent can emit.
  const m = /^session-(\d{4})-(\d{2})-(\d{2})(?:-|$)/.exec(slug);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
  const [composerOpen, setComposerOpen] = useState(false);
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
    return (
      <DashboardLayout>
        <div
          className="h-full overflow-y-auto"
          style={{ background: "var(--reader-mat)" }}
        >
          <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
            <PageHeader
              title="Journal"
              actions={
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-muted"
                >
                  <Plus className="size-3.5" strokeWidth={2} />
                  <span className="hidden sm:inline">New entry</span>
                </button>
              }
            />

            {/* Prominent search — full-width beneath the title, Claude-style */}
            <div className="mb-9 mt-5 flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
              <Search className="size-4 shrink-0 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search entries…"
                className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/55 focus:outline-none"
              />
            </div>

            {/* Empty state — a single dashed dropzone for where entries land */}
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-muted-foreground/25 bg-card/30 px-6 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-primary/65">
                <BookOpen className="size-5" strokeWidth={1.5} />
              </div>
              <p className="mt-4 text-[14px] font-medium text-foreground/80">
                Your journal entries will appear here
              </p>
            </div>
          </div>
        </div>

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
        className="h-full overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
          <PageHeader
            title="Journal"
            actions={
              <button
                type="button"
                onClick={() => void handleNewBlankEntry()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-muted"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">New entry</span>
              </button>
            }
          />

          {/* Prominent search — full-width beneath the title, Claude-style */}
          <div className="mb-9 mt-5 flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
            <Search className="size-4 shrink-0 text-muted-foreground/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries…"
              className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/55 focus:outline-none"
            />
          </div>

          {/* Entry grid */}
          {filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-[12.5px] text-muted-foreground/70">
              No entries match &ldquo;{search}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.page.id}
                  id={`card-${entry.page.slug}`}
                  className="h-full"
                >
                  <JournalCard entry={entry} onOpen={openPage} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
