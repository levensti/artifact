"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  Clock,
  FileText,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import MarkdownMessage from "@/components/markdown-message";
import {
  hydrateClientStore,
  getWikiArticlesSnapshot,
  getReviewsSnapshot,
  deleteWikiArticle,
} from "@/lib/client-data";
import { WIKI_UPDATED_EVENT } from "@/lib/wiki";
import { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";
import type { WikiArticle } from "@/lib/wiki";
import type { PaperReview } from "@/lib/review-types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const CATEGORY_COLORS: Record<string, string> = {
  concepts: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  methods: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  architectures: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  datasets: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  comparisons: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  theory: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
};

function CategoryBadge({ category }: { category: string }) {
  const color =
    CATEGORY_COLORS[category] ??
    "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}
    >
      {category}
    </span>
  );
}

function resolveWikiLinks(content: string, articles: WikiArticle[]): string {
  // Convert [[slug|display]] to markdown links
  return content.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, slug: string, display?: string) => {
      const label = display || slug;
      const exists = articles.some((a) => a.slug === slug);
      if (exists) {
        return `[${label}](/wiki?article=${encodeURIComponent(slug)})`;
      }
      return label;
    },
  );
}

export default function WikiPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading…
          </div>
        </DashboardLayout>
      }
    >
      <WikiPageInner />
    </Suspense>
  );
}

function WikiPageInner() {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSlug = searchParams.get("article");

  useEffect(() => {
    void hydrateClientStore().then(() => setReady(true));
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(WIKI_UPDATED_EVENT, bump);
    window.addEventListener(REVIEWS_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(WIKI_UPDATED_EVENT, bump);
      window.removeEventListener(REVIEWS_UPDATED_EVENT, bump);
    };
  }, []);

  void version;

  const articles = useMemo(() => {
    void version;
    return ready ? getWikiArticlesSnapshot() : [];
  }, [ready, version]);

  const reviews = useMemo(() => {
    void version;
    return ready ? getReviewsSnapshot() : [];
  }, [ready, version]);

  const reviewMap = useMemo(() => {
    const m = new Map<string, PaperReview>();
    for (const r of reviews) m.set(r.id, r);
    return m;
  }, [reviews]);

  const filtered = useMemo(() => {
    if (!search.trim()) return articles;
    const q = search.toLowerCase();
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q),
    );
  }, [articles, search]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, WikiArticle[]>();
    for (const a of filtered) {
      const list = byCategory.get(a.category) ?? [];
      list.push(a);
      byCategory.set(a.category, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const selectedArticle = useMemo(() => {
    if (!selectedSlug) return null;
    return articles.find((a) => a.slug === selectedSlug) ?? null;
  }, [articles, selectedSlug]);

  const handleDelete = useCallback(
    async (slug: string) => {
      await deleteWikiArticle(slug);
      if (selectedSlug === slug) {
        router.push("/wiki");
      }
    },
    [selectedSlug, router],
  );

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  // Empty state
  if (articles.length === 0) {
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
                  Knowledge Wiki
                </h1>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Concepts compiled from your papers
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                Your wiki is empty. As you review and analyze papers, the
                assistant will compile concept articles that synthesize knowledge
                across everything you read.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/70 text-xs">
              <span>LLM-compiled from your papers</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Grows as you read</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Cross-paper synthesis</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Article detail view
  if (selectedArticle) {
    const resolvedContent = resolveWikiLinks(
      selectedArticle.contentMd,
      articles,
    );
    const sourceReviews = selectedArticle.sourceReviewIds
      .map((id) => reviewMap.get(id))
      .filter((r): r is PaperReview => r != null);
    const relatedArticles = selectedArticle.relatedSlugs
      .map((slug) => articles.find((a) => a.slug === slug))
      .filter((a): a is WikiArticle => a != null);

    return (
      <DashboardLayout>
        <div className="flex h-full flex-col overflow-hidden bg-background">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => router.push("/wiki")}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <BookOpen className="size-4 text-primary" strokeWidth={2} />
            <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
              {selectedArticle.title}
            </h1>
            <CategoryBadge category={selectedArticle.category} />
          </header>
          <ScrollArea className="flex-1 min-h-0">
            <article className="max-w-3xl mx-auto px-6 py-8">
              <div className="mb-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  Updated{" "}
                  {new Date(selectedArticle.updatedAt).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="size-3" />
                  {sourceReviews.length} source paper
                  {sourceReviews.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownMessage content={resolvedContent} />
              </div>

              {/* Source papers */}
              {sourceReviews.length > 0 && (
                <div className="mt-8 pt-6 border-t border-border">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Source Papers
                  </h3>
                  <div className="space-y-2">
                    {sourceReviews.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => router.push(`/review/${r.id}`)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{r.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related articles */}
              {relatedArticles.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Related Articles
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {relatedArticles.map((a) => (
                      <button
                        key={a.slug}
                        type="button"
                        onClick={() =>
                          router.push(
                            `/wiki?article=${encodeURIComponent(a.slug)}`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted transition-colors"
                      >
                        <BookOpen className="size-3 text-muted-foreground" />
                        {a.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          </ScrollArea>
        </div>
      </DashboardLayout>
    );
  }

  // Article list view
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <BookOpen className="size-4 text-primary" strokeWidth={2} />
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Knowledge Wiki
          </h1>
          <span className="rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
            {articles.length} article{articles.length !== 1 ? "s" : ""}
          </span>
        </header>

        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search articles…"
              className="w-full rounded-md border border-border bg-background px-8 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-4 pb-4">
          {grouped.map(([category, categoryArticles]) => (
            <div key={category} className="mb-6 last:mb-0">
              <div className="flex items-center gap-2 mb-2 mt-2">
                <Tag className="size-3 text-muted-foreground" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {category}
                </h2>
                <span className="text-[10px] text-muted-foreground/60">
                  ({categoryArticles.length})
                </span>
              </div>
              <div className="space-y-1">
                {categoryArticles.map((article) => (
                  <div
                    key={article.slug}
                    className="group flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      router.push(
                        `/wiki?article=${encodeURIComponent(article.slug)}`,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        router.push(
                          `/wiki?article=${encodeURIComponent(article.slug)}`,
                        );
                    }}
                  >
                    <BookOpen className="size-4 mt-0.5 shrink-0 text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {article.title}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {article.summary}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <span>
                          {article.sourceReviewIds.length} paper
                          {article.sourceReviewIds.length !== 1 ? "s" : ""}
                        </span>
                        <span>·</span>
                        <span>
                          {new Date(article.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(article.slug);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && search.trim() && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No articles match &ldquo;{search}&rdquo;
            </div>
          )}
        </ScrollArea>
      </div>
    </DashboardLayout>
  );
}
