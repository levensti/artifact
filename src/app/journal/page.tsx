"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, Plus, Search, Terminal } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import JournalCard, { type JournalEntry } from "@/components/journal-card";
import JournalEntryModal from "@/components/journal-entry-modal";
import JournalImportModal from "@/components/journal-import-modal";
import JournalComposerModal from "@/components/journal-composer-modal";
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
import { MonoLabel } from "@/components/folio";

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

function shortDate(d: Date): string {
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
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

  // Group entries by last-updated date so the timeline has visible day
  // sections. We sort entries by updatedAt (newest first) inside each
  // section so a streaming entry bubbles to the top as it changes.
  const groupedEntries = useMemo(() => {
    const sorted = [...filteredEntries].sort((a, b) => {
      const ua = new Date(a.page.updatedAt).getTime();
      const ub = new Date(b.page.updatedAt).getTime();
      return ub - ua;
    });
    const groups: {
      key: string;
      label: string;
      date: Date;
      entries: typeof filteredEntries;
    }[] = [];
    const seen = new Map<string, number>();
    for (const e of sorted) {
      const d = new Date(e.page.updatedAt);
      const key = localDateKey(d);
      const idx = seen.get(key);
      if (idx === undefined) {
        seen.set(key, groups.length);
        groups.push({ key, label: relativeDayLabel(d), date: d, entries: [e] });
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
          <div className="mx-auto w-full max-w-160 px-6 pt-[min(12vh,112px)] pb-16">
            {/* Header */}
            <div className="mb-9">
              <MonoLabel>Journal</MonoLabel>
              <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground">
                Everything you&apos;ve read.
              </h1>
              <p
                className="mt-3 max-w-[460px] text-[14px] leading-[1.6]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--foreground) 70%, transparent)",
                }}
              >
                A running log of what you read and build. Entries appear here as
                you save chats from a review or import a coding session, or you
                can write one yourself.
              </p>
            </div>

            {/* Ghost timeline — shows the shape of what will fill in */}
            <div className="relative">
              {/* Vertical timeline spine */}
              <div className="absolute left-3.75 top-2 bottom-6 w-px bg-border/50" />

              {/* Today — the active slot */}
              <div className="relative mb-6 pl-10">
                <div className="absolute left-2.75 top-1.75 size-2.25 rounded-full border-2 border-primary/50 bg-background" />
                <MonoLabel tone="accent">Today &middot; {todayLabel}</MonoLabel>
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
              void refreshPages();
              setReloadTick((t) => t + 1);
            }}
          />
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

  return (
    <DashboardLayout>
      <div
        className="flex h-full flex-col overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
        <div className="mx-auto w-full max-w-[1040px] px-5 pb-16 pt-12 sm:px-12 sm:pt-[52px]">
          {/* Header + toolbar */}
          <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <header className="max-w-[520px]">
              <MonoLabel>Journal</MonoLabel>
              <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground">
                Everything you&apos;ve read.
              </h1>
              <p
                className="mt-3 text-[15px] leading-[1.6]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--foreground) 66%, transparent)",
                }}
              >
                <span className="font-semibold text-foreground">
                  {journalEntries.length}{" "}
                  {journalEntries.length === 1 ? "entry" : "entries"}
                </span>{" "}
                so far, cross-linked across the topics you keep returning to.
              </p>
            </header>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 transition-colors focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10">
                <Search className="size-3.5 shrink-0 text-muted-foreground/45" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search entries…"
                  className="w-40 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/55 focus:outline-none sm:w-52"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleNewBlankEntry()}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-muted"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                New entry
              </button>
            </div>
          </div>

          {/* Timeline */}
          {filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-[12.5px] text-muted-foreground/70">
              No entries match &ldquo;{search}&rdquo;.
            </div>
          ) : (
            <div className="relative">
              {/* Spine — aligned to the timeline nodes */}
              <div
                className="absolute top-1.5 bottom-1.5 hidden w-px sm:block"
                style={{
                  left: 119,
                  background:
                    "color-mix(in srgb, var(--border) 80%, transparent)",
                }}
              />
              {groupedEntries.map((group) => {
                const showSub = !/\d/.test(group.label);
                return (
                  <section key={group.key} className="mb-7">
                    {group.entries.map((entry, i) => (
                      <div
                        key={entry.page.id}
                        id={`card-${entry.page.slug}`}
                        className="relative mb-3.5 grid gap-4 sm:grid-cols-[104px_1fr] sm:gap-8"
                      >
                        {/* Date column */}
                        <div className="pt-4 text-left sm:text-right">
                          {i === 0 ? (
                            <>
                              <div className="text-[14px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                                {group.label}
                              </div>
                              {showSub ? (
                                <span className="mt-0.5 block">
                                  <MonoLabel>{shortDate(group.date)}</MonoLabel>
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </div>

                        {/* Spine node */}
                        <div
                          className="absolute hidden size-[9px] rounded-full sm:block"
                          style={{
                            left: 116,
                            top: 22,
                            background: "var(--background)",
                            border: `2px solid ${
                              entry.kind === "digest"
                                ? "var(--primary)"
                                : "color-mix(in srgb, var(--muted-foreground) 55%, transparent)"
                            }`,
                          }}
                        />

                        {/* Card */}
                        <div className="sm:pl-2">
                          <JournalCard entry={entry} onOpen={openPage} />
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {importOpen ? (
        <JournalImportModal
          onClose={() => {
            setImportOpen(false);
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
