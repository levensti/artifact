"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FileText,
  History,
  Link2,
  Quote,
  Sparkles,
} from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import {
  loadWikiPageMetadata,
  type WikiPageMetadata,
} from "@/lib/client-data";
import { cn } from "@/lib/utils";
import MarkdownMessage from "./markdown-message";
import { Badge } from "@/components/ui/badge";
import WikiRevisionDialog from "./wiki-revision-dialog";

const TYPE_LABELS: Record<string, string> = {
  paper: "Paper",
  concept: "Concept",
  method: "Method",
  entity: "Entity",
  graph: "Graph",
  index: "Index",
  log: "Log",
};

const TYPE_ICON_COLOR: Record<string, string> = {
  paper: "text-emerald-600",
  concept: "text-blue-600",
  method: "text-purple-600",
  entity: "text-amber-700",
};

interface WikiPageViewProps {
  page: WikiPage;
  onNavigate: (slug: string) => void;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function WikiPageView({ page, onNavigate }: WikiPageViewProps) {
  // Scope meta to the slug it was loaded for so a stale fetch landing
  // after navigation doesn't render against the wrong page.
  const [metaEntry, setMetaEntry] = useState<{
    slug: string;
    data: WikiPageMetadata;
  } | null>(null);
  const [revisionId, setRevisionId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWikiPageMetadata(page.slug)
      .then((m) => {
        if (!cancelled) setMetaEntry({ slug: page.slug, data: m });
      })
      .catch(() => {
        if (!cancelled)
          setMetaEntry({
            slug: page.slug,
            data: { backlinks: [], sources: [], revisions: [] },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [page.slug]);

  const meta = metaEntry && metaEntry.slug === page.slug ? metaEntry.data : null;

  const updatedDate = formatRelative(page.updatedAt);

  const typeColor = TYPE_ICON_COLOR[page.pageType] ?? "text-primary";

  const sourcesWithPassage = useMemo(
    () => meta?.sources.filter((s) => s.passage && s.passage.trim()) ?? [],
    [meta],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 flex-wrap">
        <BookOpen className={cn("size-4", typeColor)} strokeWidth={2} />
        <Badge
          variant="secondary"
          className="text-[10px] uppercase tracking-wider font-semibold"
        >
          {TYPE_LABELS[page.pageType] ?? page.pageType}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Updated {updatedDate}
        </span>
        {meta && meta.revisions.length > 0 ? (
          <button
            type="button"
            onClick={() => setRevisionId(meta.revisions[0].id)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title="View revision history"
          >
            <History className="size-3" strokeWidth={2} />
            {meta.revisions.length}{" "}
            {meta.revisions.length === 1 ? "update" : "updates"}
          </button>
        ) : null}
      </div>

      <div className="prose-wiki">
        <MarkdownMessage content={page.content} />
      </div>

      {/* Enriched sections — sources, backlinks, related — load lazily.    */}
      {meta && (
        <div className="mt-4 flex flex-col gap-6 border-t border-border pt-6">
          {sourcesWithPassage.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Quote className="size-3" strokeWidth={2} />
                Why was this added?
              </h3>
              <ul className="space-y-2.5">
                {sourcesWithPassage.map((s) => (
                  <li
                    key={s.reviewId}
                    className="rounded-md border-l-2 border-l-primary/40 bg-muted/30 px-3 py-2 text-xs leading-relaxed"
                  >
                    <div className="text-foreground italic">
                      &ldquo;{s.passage}&rdquo;
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      — {s.reviewTitle ?? s.reviewArxivId ?? "Unknown source"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {meta.sources.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="size-3" strokeWidth={2} />
                Sources ({meta.sources.length})
              </h3>
              <ul className="space-y-1 text-xs">
                {meta.sources.map((s) => (
                  <li key={s.reviewId}>
                    <a
                      href={`/review/${s.reviewId}`}
                      className="text-primary hover:underline"
                    >
                      {s.reviewTitle ?? s.reviewArxivId ?? s.reviewId}
                    </a>
                    {s.addedAt ? (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {formatRelative(s.addedAt)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {meta.backlinks.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Link2 className="size-3" strokeWidth={2} />
                Referenced in ({meta.backlinks.length})
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                {meta.backlinks.map((b) => (
                  <li key={b.sourceSlug}>
                    <button
                      type="button"
                      onClick={() => onNavigate(b.sourceSlug)}
                      className="group flex w-full items-center gap-1.5 rounded-md border border-border bg-card/50 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                    >
                      <Sparkles
                        className={cn(
                          "size-3 shrink-0",
                          TYPE_ICON_COLOR[b.sourcePageType] ??
                            "text-muted-foreground",
                        )}
                        strokeWidth={2}
                      />
                      <span className="truncate group-hover:text-foreground text-muted-foreground">
                        {b.sourceTitle}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {revisionId !== null && meta ? (
        <WikiRevisionDialog
          currentTitle={page.title}
          currentContent={page.content}
          revisions={meta.revisions}
          initialRevisionId={revisionId}
          onClose={() => setRevisionId(null)}
        />
      ) : null}
    </div>
  );
}
