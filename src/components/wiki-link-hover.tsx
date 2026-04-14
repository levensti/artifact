"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { BookOpen, AlertCircle } from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { loadWikiPage } from "@/lib/client-data";
import { cn } from "@/lib/utils";

interface WikiLinkHoverProps {
  slug: string;
  children?: React.ReactNode;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  paper: "paper",
  concept: "concept",
  method: "method",
  entity: "entity",
  graph: "graph",
  index: "index",
  log: "log",
};

const TYPE_COLORS: Record<string, string> = {
  paper: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  concept: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  method: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  entity: "bg-amber-500/10 text-amber-700 border-amber-500/20",
};

function firstParagraph(content: string): string {
  const lines = content.split("\n");
  const body: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (body.length > 0) break;
      continue;
    }
    if (line.startsWith("#")) continue;
    body.push(line);
    if (body.join(" ").length > 220) break;
  }
  const joined = body.join(" ").replace(/\[\[([^\]]+)\]\]/g, "$1");
  return joined.length > 220 ? joined.slice(0, 220).trimEnd() + "…" : joined;
}

/**
 * Rich rendering for [[slug]] wiki references in markdown output.
 *
 * Appears as a compact chip (type badge + title). On hover, lazy-loads
 * the target wiki page and shows a preview tooltip. Clicks navigate to
 * `/wiki?page=slug` via next/router.
 *
 * Used anywhere markdown is rendered — chat messages, wiki page
 * content, the recent activity timeline.
 */
export default function WikiLinkHover({
  slug,
  children,
  className,
}: WikiLinkHoverProps) {
  const router = useRouter();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    loadWikiPage(slug)
      .then((p) => {
        setPage(p);
        setError(p === null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Load lazily on hover/focus only. Rendering a long markdown doc with
  // dozens of [[slug]] chips shouldn't fan out a fetch per chip on mount.

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      router.push(`/wiki?page=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router, slug],
  );

  const typeClass = page ? TYPE_COLORS[page.pageType] : "";
  const label = page?.title ?? (children as React.ReactNode) ?? slug;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        render={
          <a
            href={`/wiki?page=${encodeURIComponent(slug)}`}
            onClick={handleClick}
            onMouseEnter={ensureLoaded}
            onFocus={ensureLoaded}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[0.95em] font-medium leading-tight no-underline transition-colors align-baseline",
              page
                ? typeClass
                : error
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-primary/20 bg-primary/5 text-primary",
              "hover:brightness-95",
              className,
            )}
          />
        }
      >
        <span className="inline-flex items-center gap-1">
          {page ? (
            <BookOpen className="size-3 shrink-0 opacity-60" strokeWidth={2} />
          ) : error ? (
            <AlertCircle className="size-3 shrink-0" strokeWidth={2} />
          ) : null}
          <span>{label}</span>
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side="top"
          align="start"
          sideOffset={6}
          className="z-100"
        >
          <TooltipPrimitive.Popup
            className={cn(
              "max-w-[min(92vw,22rem)] origin-(--transform-origin) rounded-lg border border-border/80 bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/5",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-100",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-75",
            )}
          >
            {loading && !page ? (
              <div className="text-muted-foreground italic">Loading…</div>
            ) : error || !page ? (
              <div className="space-y-1">
                <div className="font-semibold">Not yet in the wiki</div>
                <div className="text-muted-foreground">
                  <code className="text-[11px]">[[{slug}]]</code> — will be
                  created on a future ingest.
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider",
                      TYPE_COLORS[page.pageType] ??
                        "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {TYPE_LABELS[page.pageType] ?? page.pageType}
                  </span>
                  <span className="font-semibold text-foreground">
                    {page.title}
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {firstParagraph(page.content) || "No content yet."}
                </p>
              </div>
            )}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
