"use client";

import { useMemo } from "react";
import type { WikiPage } from "@/lib/wiki";
import MarkdownMessage from "./markdown-message";
import { Badge } from "@/components/ui/badge";

const TYPE_LABELS: Record<string, string> = {
  paper: "Paper",
  concept: "Concept",
  method: "Method",
  entity: "Entity",
  graph: "Graph",
  index: "Index",
  log: "Log",
};

interface WikiPageViewProps {
  page: WikiPage;
  onNavigate: (slug: string) => void;
}

export default function WikiPageView({ page, onNavigate }: WikiPageViewProps) {
  // Replace [[slug]] with clickable links
  const processedContent = useMemo(() => {
    return page.content.replace(
      /\[\[([a-z0-9-]+)\]\]/g,
      (_match, slug: string) => `[${slug}](/wiki?page=${slug})`,
    );
  }, [page.content]);

  const updatedDate = new Date(page.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="secondary"
          className="text-[10px] uppercase tracking-wider font-semibold"
        >
          {TYPE_LABELS[page.pageType] ?? page.pageType}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Updated {updatedDate}
        </span>
      </div>

      <div
        className="prose-wiki"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const anchor = target.closest("a");
          if (!anchor) return;
          const href = anchor.getAttribute("href");
          if (href?.startsWith("/wiki?page=")) {
            e.preventDefault();
            const slug = href.replace("/wiki?page=", "");
            onNavigate(slug);
          }
        }}
      >
        <MarkdownMessage content={processedContent} />
      </div>
    </div>
  );
}
