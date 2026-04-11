"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BookOpen, Search, FileText } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import WikiPageView from "@/components/wiki-page-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hydrateClientStore, loadWikiPages } from "@/lib/client-data";
import type { WikiPage } from "@/lib/wiki";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
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

export default function WikiBrowsePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [search, setSearch] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    searchParams.get("page"),
  );

  // Load pages
  const refreshPages = useCallback(async () => {
    const list = await loadWikiPages();
    setPages(list);
  }, []);

  useEffect(() => {
    void hydrateClientStore().then(async () => {
      await refreshPages();
      setReady(true);
    });
    const handler = () => void refreshPages();
    window.addEventListener(WIKI_UPDATED_EVENT, handler);
    return () => window.removeEventListener(WIKI_UPDATED_EVENT, handler);
  }, [refreshPages]);

  // Sync URL param
  useEffect(() => {
    const slugFromUrl = searchParams.get("page");
    if (slugFromUrl && slugFromUrl !== selectedSlug) {
      setSelectedSlug(slugFromUrl);
    }
  }, [searchParams, selectedSlug]);

  const handleNavigate = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      router.push(`/wiki?page=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router],
  );

  // Filter out index/log from main listing
  const contentPages = useMemo(
    () => pages.filter((p) => p.pageType !== "index" && p.pageType !== "log"),
    [pages],
  );

  // Search filter
  const filteredPages = useMemo(() => {
    if (!search.trim()) return contentPages;
    const q = search.toLowerCase();
    return contentPages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q),
    );
  }, [contentPages, search]);

  // Group by type
  const grouped = useMemo(() => {
    const map = new Map<string, WikiPage[]>();
    for (const p of filteredPages) {
      const list = map.get(p.pageType) ?? [];
      list.push(p);
      map.set(p.pageType, list);
    }
    return [...map.entries()].sort(
      (a, b) => (TYPE_ORDER[a[0]] ?? 99) - (TYPE_ORDER[b[0]] ?? 99),
    );
  }, [filteredPages]);

  const selectedPage = useMemo(
    () => pages.find((p) => p.slug === selectedSlug) ?? null,
    [pages, selectedSlug],
  );

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading\u2026
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
        {/* Left panel \u2014 page list */}
        <aside className="flex h-full w-[280px] min-w-[240px] shrink-0 flex-col border-r border-border">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <BookOpen className="size-4 text-primary" strokeWidth={2} />
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Knowledge Base
            </h1>
            <span className="ml-auto rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
              {contentPages.length}
            </span>
          </header>

          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-ring/20">
              <Search className="size-3.5 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pages\u2026"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 py-2 space-y-3">
              {grouped.map(([type, typePages]) => (
                <div key={type}>
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {TYPE_LABELS[type] ?? type}
                  </p>
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
            </div>
          </ScrollArea>
        </aside>

        {/* Right panel \u2014 page content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {selectedPage ? (
            <div className="max-w-3xl mx-auto px-8 py-6">
              <WikiPageView
                page={selectedPage}
                onNavigate={handleNavigate}
              />
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
