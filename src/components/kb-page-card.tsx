"use client";

import Link from "next/link";
import type { WikiPage } from "@/lib/kb-types";
import { cn } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  concept: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  method: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  result: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "paper-summary": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  topic: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function firstLine(content: string): string {
  // Strip frontmatter
  let c = content;
  if (c.startsWith("---")) {
    const end = c.indexOf("---", 3);
    if (end !== -1) c = c.slice(end + 3).trim();
  }
  // Strip heading markers
  c = c.replace(/^#+\s+.*\n?/, "").trim();
  // Get first non-empty line
  const line = c.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > 120 ? line.slice(0, 117) + "…" : line;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

interface KbPageCardProps {
  page: WikiPage;
}

export default function KbPageCard({ page }: KbPageCardProps) {
  return (
    <Link
      href={`/kb/${page.slug}`}
      className="group block rounded-lg border border-border/60 bg-card px-3.5 py-3 transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            TYPE_COLORS[page.pageType] ?? "bg-muted text-muted-foreground",
          )}
        >
          {page.pageType}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary truncate">
            {page.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {firstLine(page.content)}
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
          {formatDate(page.updatedAt)}
        </span>
      </div>
      {page.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {page.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="inline-flex rounded-full bg-muted/60 px-1.5 py-px text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
