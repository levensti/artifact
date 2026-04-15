"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, Search } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import JournalCard, { type JournalEntry } from "@/components/journal-card";
import JournalEntryModal from "@/components/journal-entry-modal";
import {
  getSavedSelectedModel,
  hydrateClientStore,
  loadWikiPages,
} from "@/lib/client-data";
import { getApiKey, isInferenceProviderType, isModelReady } from "@/lib/keys";
import type { WikiPage } from "@/lib/wiki";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
import { localDateKey } from "@/lib/date-keys";
import { maybeRefreshJournal } from "@/lib/wiki-journal-agent";

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
        // Eager journal-agent run on wiki open. Skips internally if no
        // activity has happened since the last run.
        const model = getSavedSelectedModel();
        if (model && isModelReady(model)) {
          const apiKey = isInferenceProviderType(model.provider)
            ? ""
            : (getApiKey(model.provider) ?? "");
          void maybeRefreshJournal({
            model,
            apiKey,
            trigger: "wiki-load",
          }).catch(() => {
            /* ambient */
          });
        }
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
      router.push(`/journal?page=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router],
  );

  const closeModal = useCallback(() => {
    router.replace("/journal", { scroll: false });
  }, [router]);

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

  const todayKey = localDateKey();
  const todaySessionSlug = useMemo(() => {
    const todays = journalEntries.filter(
      (e) => e.kind === "session" && localDateKey(e.date) === todayKey,
    );
    return todays[0]?.page.slug ?? null;
  }, [journalEntries, todayKey]);
  const scrollToToday = () => {
    if (!todaySessionSlug) return;
    const el = document.getElementById(`card-${todaySessionSlug}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/40");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary/40");
      }, 1200);
    }
  };
  const hasTodaySession = todaySessionSlug !== null;

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
            <AlertTriangle className="mx-auto size-8 text-amber-600" />
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
        <div className="flex h-full items-center justify-center bg-background px-6">
          <div className="max-w-md space-y-8 text-center">
            <div className="space-y-4">
              <h1 className="text-[36px] font-bold leading-[1.1] tracking-[-0.028em] text-foreground">
                Your journal is empty
              </h1>
              <p className="mx-auto max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Read a paper to start your first study session. As you work, a
                daily recap and weekly digest will appear here automatically.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground/70">
              <span>One page per day</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Weekly synthesis</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Built in the background by your assistant</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1180px] px-8 pb-16 pt-10">
          {/* Header */}
          <header className="mb-6 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold leading-snug tracking-tight text-foreground">
                Journal
              </p>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground/60">
                {journalEntries.length}{" "}
                {journalEntries.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/70">
              Daily recaps and weekly syntheses build here automatically.
            </p>
          </header>

          {/* Toolbar */}
          <div className="mb-6 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm transition-colors focus-within:border-primary/30">
              <Search className="size-[13px] shrink-0 text-muted-foreground/60" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search journal…"
                className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            {hasTodaySession ? (
              <button
                type="button"
                onClick={scrollToToday}
                className="rounded-xl border border-border/60 bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-foreground"
              >
                Today
              </button>
            ) : null}
          </div>

          {/* Grid */}
          {filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-[12.5px] text-muted-foreground/70">
              No entries match &ldquo;{search}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {filteredEntries.map((entry) => (
                <div key={entry.page.id} id={`card-${entry.page.slug}`}>
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
    </DashboardLayout>
  );
}
