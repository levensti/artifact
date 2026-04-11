"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import Link from "next/link";
import DashboardLayout from "@/components/dashboard-layout";
import WikiMarkdown from "@/components/wiki-markdown";
import { hydrateClientStore, loadWikiPage, loadWikiPages } from "@/lib/client-data";
import type { WikiPage, WikiPageSource } from "@/lib/kb-types";
import { getReview } from "@/lib/reviews";
import { cn } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  concept: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  method: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  result: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "paper-summary": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  topic: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

/** Extract [[slug]] references from markdown content. */
function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g);
  const slugs = new Set<string>();
  for (const m of matches) {
    slugs.add(m[1].trim());
  }
  return [...slugs];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function WikiPageViewer() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<(WikiPage & { sources?: WikiPageSource[] }) | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [knownSlugs, setKnownSlugs] = useState<Set<string>>(new Set());
  const [sourceReviews, setSourceReviews] = useState<
    { reviewId: string; title: string }[]
  >([]);

  useEffect(() => {
    void hydrateClientStore().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void loadWikiPage(params.slug).then((data) => {
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
        return;
      }
      setPage(data);

      // Resolve source review titles
      const reviews: { reviewId: string; title: string }[] = [];
      for (const src of data.sources ?? []) {
        const review = getReview(src.reviewId);
        if (review) {
          reviews.push({ reviewId: review.id, title: review.title });
        }
      }
      setSourceReviews(reviews);
    });

    // Load known slugs for link validation
    void loadWikiPages().then((allPages) => {
      if (!cancelled) {
        setKnownSlugs(new Set(allPages.map((p) => p.slug)));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, params.slug]);

  if (!ready || (!page && !notFound)) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  if (notFound) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full px-6 bg-background">
          <div className="text-center space-y-4">
            <p className="text-lg font-semibold text-foreground">Page not found</p>
            <p className="text-sm text-muted-foreground">
              No KB page with slug &ldquo;{params.slug}&rdquo; exists yet.
            </p>
            <Link
              href="/kb"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" /> Back to Knowledge Base
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const relatedSlugs = page ? extractWikiLinks(page.content) : [];

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Link
            href="/kb"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <BookOpen className="size-3.5" />
          </Link>
          <span className="text-border/50">/</span>
          <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
            {page!.title}
          </h1>
          <span
            className={cn(
              "ml-2 inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              TYPE_COLORS[page!.pageType] ?? "bg-muted text-muted-foreground",
            )}
          >
            {page!.pageType}
          </span>
        </header>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            {/* Tags */}
            {page!.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-6">
                {page!.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Main content */}
            <WikiMarkdown content={page!.content} knownSlugs={knownSlugs} />

            {/* Source papers */}
            {sourceReviews.length > 0 && (
              <div className="mt-10 pt-6 border-t border-border">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3">
                  Source Papers
                </h3>
                <div className="space-y-1.5">
                  {sourceReviews.map((r) => (
                    <Link
                      key={r.reviewId}
                      href={`/review/${r.reviewId}`}
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      {r.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Related pages */}
            {relatedSlugs.length > 0 && (
              <div className="mt-6 pt-6 border-t border-border">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3">
                  Related Pages
                </h3>
                <div className="flex flex-wrap gap-2">
                  {relatedSlugs.map((slug) => (
                    <Link
                      key={slug}
                      href={`/kb/${slug}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                        knownSlugs.has(slug)
                          ? "border-primary/20 text-primary hover:bg-primary/5"
                          : "border-border text-muted-foreground/50",
                      )}
                    >
                      <BookOpen className="size-3" />
                      {slug}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Meta */}
            <div className="mt-6 pt-4 border-t border-border/60 text-[11px] text-muted-foreground/60">
              Created {formatDate(page!.createdAt)} · Updated{" "}
              {formatDate(page!.updatedAt)}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
