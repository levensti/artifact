"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  FileText,
  Search,
  Shield,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import WikiPageView from "@/components/wiki-page-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hydrateClientStore, loadWikiPages } from "@/lib/client-data";
import type { WikiPage } from "@/lib/wiki";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
import { lintPages, runWikiLint, type WikiLintReport } from "@/lib/wiki-lint";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";

const TYPE_ORDER: Record<string, number> = {
  paper: 0,
  concept: 1,
  method: 2,
  entity: 3,
  graph: 4,
};

const TYPE_LABELS: Record<string, string> = {
  paper: "Papers",
  concept: "Concepts",
  method: "Methods",
  entity: "Entities",
  graph: "Graphs",
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "paper", label: "Papers" },
  { key: "concept", label: "Concepts" },
  { key: "method", label: "Methods" },
  { key: "entity", label: "Entities" },
];

type SortMode = "recent" | "alpha";

/**
 * Parses `log.md` append-only content into a structured timeline.
 * Lines in the log have format: `- \`DATE TIME\` **kind** — label`
 */
interface LogEntry {
  when: string;
  kind: string;
  label: string;
}

function parseLog(content: string): LogEntry[] {
  const out: LogEntry[] = [];
  const re = /^-\s*`([\d\-: ]+)`\s*\*\*([^*]+)\*\*\s*[—-]\s*(.+)$/;
  for (const line of content.split("\n")) {
    const m = re.exec(line.trim());
    if (!m) continue;
    out.push({ when: m[1].trim(), kind: m[2].trim(), label: m[3].trim() });
  }
  return out.reverse();
}

export default function WikiBrowsePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [tab, setTab] = useState<"pages" | "activity" | "health">("pages");
  const [lint, setLint] = useState<WikiLintReport | null>(null);
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
        /* ignore — header badge will still update on next event */
      });
    window.addEventListener(WIKI_UPDATED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(WIKI_UPDATED_EVENT, handler);
    };
  }, [refreshPages, reloadTick]);

  // Refresh lint report whenever the wiki changes. `runWikiLint` just
  // wraps `lintPages` around a fetch, so if the fetch fails we still
  // have the in-memory pages to lint locally — never leave the Health
  // tab stuck on "Running lint…".
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void runWikiLint()
      .then((r) => {
        if (!cancelled) setLint(r);
      })
      .catch(() => {
        if (!cancelled) setLint(lintPages(pages));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, pages]);

  const handleNavigate = useCallback(
    (slug: string) => {
      router.push(`/wiki?page=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router],
  );

  const contentPages = useMemo(
    () => pages.filter((p) => p.pageType !== "index" && p.pageType !== "log"),
    [pages],
  );

  const logEntries = useMemo(() => {
    const logPage = pages.find((p) => p.slug === "log");
    if (!logPage) return [];
    return parseLog(logPage.content);
  }, [pages]);

  const filteredPages = useMemo(() => {
    let list = contentPages;
    if (filter !== "all") {
      list = list.filter((p) => p.pageType === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q),
      );
    }
    return list;
  }, [contentPages, search, filter]);

  const sortedPages = useMemo(() => {
    const list = [...filteredPages];
    if (sort === "recent") {
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [filteredPages, sort]);

  const grouped = useMemo<ReadonlyArray<readonly [string, WikiPage[]]>>(() => {
    if (sort === "recent") {
      return [["all", sortedPages] as const];
    }
    const map = new Map<string, WikiPage[]>();
    for (const p of sortedPages) {
      const list = map.get(p.pageType) ?? [];
      list.push(p);
      map.set(p.pageType, list);
    }
    return [...map.entries()].sort(
      (a, b) => (TYPE_ORDER[a[0]] ?? 99) - (TYPE_ORDER[b[0]] ?? 99),
    );
  }, [sortedPages, sort]);

  const selectedPage = useMemo(
    () => pages.find((p) => p.slug === selectedSlug) ?? null,
    [pages, selectedSlug],
  );

  const healthIssueCount = lint
    ? lint.brokenRefs.length +
      lint.orphans.length +
      lint.stale.length +
      lint.stubs.length
    : 0;

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
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

  if (contentPages.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full px-6 bg-background">
          <div className="max-w-md text-center space-y-8">
            <div className="mx-auto size-16 rounded-xl border border-border bg-card flex items-center justify-center">
              <BookOpen size={28} className="text-primary" strokeWidth={1.5} />
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Knowledge Base
                </h1>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Your ambient second brain
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                Your knowledge base will grow as you read papers and chat with
                the assistant. Concepts, methods, and paper summaries are
                extracted and organized automatically.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/70 text-xs">
              <span>Grows as you read</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Cross-referenced wiki</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Built by your assistant</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden bg-background">
        {/* Left panel — page list / activity / health */}
        <aside className="flex h-full w-[300px] min-w-[260px] shrink-0 flex-col border-r border-border">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <BookOpen className="size-4 text-primary" strokeWidth={2} />
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Knowledge Base
            </h1>
            <span className="ml-auto rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
              {contentPages.length}
            </span>
          </header>

          <div className="flex border-b border-border text-[11px] font-medium">
            {[
              { k: "pages", label: "Pages", icon: FileText },
              { k: "activity", label: "Activity", icon: Activity },
              { k: "health", label: "Health", icon: Shield },
            ].map(({ k, label, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k as "pages" | "activity" | "health")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 py-2 transition-colors relative",
                  tab === k
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" />
                {label}
                {k === "health" && healthIssueCount > 0 ? (
                  <span className="ml-0.5 rounded-full bg-amber-500/20 text-amber-700 px-1 text-[9px] font-semibold">
                    {healthIssueCount}
                  </span>
                ) : null}
                {tab === k ? (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-primary" />
                ) : null}
              </button>
            ))}
          </div>

          {tab === "pages" && (
            <>
              <div className="px-3 py-2 border-b border-border space-y-2">
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-ring/20">
                  <Search className="size-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search pages…"
                    className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                        filter === f.key
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                  <div className="ml-auto flex gap-0.5 rounded-full border border-border bg-card p-0.5">
                    {(["recent", "alpha"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSort(s)}
                        className={cn(
                          "rounded-full px-2 py-px text-[9px] font-semibold uppercase tracking-wider transition-colors",
                          sort === s
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {s === "recent" ? "Recent" : "A-Z"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="px-2 py-2 space-y-3">
                  {grouped.map(([type, typePages]) => (
                    <div key={type}>
                      {sort === "alpha" ? (
                        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          {TYPE_LABELS[type] ?? type}
                        </p>
                      ) : null}
                      <div className="space-y-0.5">
                        {typePages.map((page) => (
                          <button
                            key={page.id}
                            type="button"
                            onClick={() => handleNavigate(page.slug)}
                            className={cn(
                              "w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors",
                              selectedSlug === page.slug
                                ? "bg-primary/10 text-foreground font-medium"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            <span className="line-clamp-2 leading-relaxed">
                              {page.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {sortedPages.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No pages match.
                    </p>
                  ) : null}
                </div>
              </ScrollArea>
            </>
          )}

          {tab === "activity" && (
            <ScrollArea className="flex-1">
              <div className="px-3 py-3 space-y-0.5">
                {logEntries.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No activity yet.
                  </p>
                ) : (
                  logEntries.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2 border-l-2 border-l-primary/30 pl-3 py-1.5 text-[11px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground leading-tight truncate">
                          <span className="font-medium">{e.kind}</span> —{" "}
                          {e.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatRelative(e.when)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}

          {tab === "health" && (
            <ScrollArea className="flex-1">
              <div className="px-3 py-3 space-y-4 text-[11px]">
                {!lint ? (
                  <p className="text-muted-foreground">Running lint…</p>
                ) : healthIssueCount === 0 ? (
                  <p className="text-emerald-600 flex items-center gap-1">
                    <Shield className="size-3" />
                    All {lint.totalPages} pages healthy
                  </p>
                ) : (
                  <>
                    {lint.brokenRefs.length > 0 && (
                      <HealthSection
                        label={`Broken refs (${lint.brokenRefs.length})`}
                      >
                        {lint.brokenRefs.map((b) => (
                          <button
                            key={`${b.sourceSlug}→${b.targetSlug}`}
                            type="button"
                            onClick={() => handleNavigate(b.sourceSlug)}
                            className="block w-full text-left py-0.5 hover:text-foreground"
                          >
                            <span className="text-muted-foreground">
                              {b.sourceTitle}
                            </span>{" "}
                            →{" "}
                            <code className="text-rose-600 text-[10px]">
                              [[{b.targetSlug}]]
                            </code>
                          </button>
                        ))}
                      </HealthSection>
                    )}
                    {lint.orphans.length > 0 && (
                      <HealthSection label={`Orphans (${lint.orphans.length})`}>
                        {lint.orphans.map((o) => (
                          <button
                            key={o.slug}
                            type="button"
                            onClick={() => handleNavigate(o.slug)}
                            className="block w-full text-left py-0.5 text-muted-foreground hover:text-foreground"
                          >
                            {o.title}
                          </button>
                        ))}
                      </HealthSection>
                    )}
                    {lint.stubs.length > 0 && (
                      <HealthSection label={`Stubs (${lint.stubs.length})`}>
                        {lint.stubs.map((s) => (
                          <button
                            key={s.slug}
                            type="button"
                            onClick={() => handleNavigate(s.slug)}
                            className="block w-full text-left py-0.5 text-muted-foreground hover:text-foreground"
                          >
                            {s.title}
                            <span className="ml-1 text-[9px] opacity-60">
                              {s.wordCount} words
                            </span>
                          </button>
                        ))}
                      </HealthSection>
                    )}
                    {lint.stale.length > 0 && (
                      <HealthSection label={`Stale (${lint.stale.length})`}>
                        {lint.stale.map((s) => (
                          <button
                            key={s.slug}
                            type="button"
                            onClick={() => handleNavigate(s.slug)}
                            className="block w-full text-left py-0.5 text-muted-foreground hover:text-foreground"
                          >
                            {s.title}
                            <span className="ml-1 text-[9px] opacity-60">
                              {s.ageDays}d old
                            </span>
                          </button>
                        ))}
                      </HealthSection>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </aside>

        {/* Right panel — page content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {selectedPage ? (
            <div className="max-w-3xl mx-auto px-8 py-6">
              <WikiPageView page={selectedPage} onNavigate={handleNavigate} />
            </div>
          ) : selectedSlug ? (
            <div className="flex items-center justify-center h-full px-6">
              <div className="text-center space-y-3 max-w-sm">
                <AlertTriangle
                  className="mx-auto size-8 text-amber-500/60"
                  strokeWidth={1.5}
                />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                      [[{selectedSlug}]]
                    </code>{" "}
                    isn&apos;t in the wiki yet
                  </p>
                  <p className="text-xs text-muted-foreground">
                    It may be created on a future ingest. In the meantime,
                    browse the other pages in the sidebar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    router.push("/wiki", { scroll: false })
                  }
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Back to knowledge base
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full px-6">
              <div className="text-center space-y-3 max-w-sm">
                <FileText className="mx-auto size-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Select a page from the sidebar to view its content.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </DashboardLayout>
  );
}

function HealthSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-1 font-semibold uppercase tracking-wider text-[10px] text-amber-700">
        <AlertTriangle className="size-3" strokeWidth={2} />
        {label}
      </h3>
      <div className="pl-3 space-y-0">{children}</div>
    </section>
  );
}
