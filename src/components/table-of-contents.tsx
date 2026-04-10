"use client";

import { useMemo } from "react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TocEntry {
  title: string;
  pageNumber: number;
  level: number; // 1 = section, 2 = subsection
}

/**
 * Extract section headings from extracted PDF text.
 * Heuristic: lines matching common academic paper section patterns.
 */
export function extractTocEntries(text: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const pageBlocks = text.split(/\[Page (\d+)\]/);

  // pageBlocks: ["", "1", "page1text", "2", "page2text", ...]
  for (let i = 1; i < pageBlocks.length; i += 2) {
    const pageNumber = parseInt(pageBlocks[i], 10);
    const pageText = pageBlocks[i + 1] ?? "";

    const lines = pageText.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 120) continue;

      // Match "Abstract"
      if (/^abstract$/i.test(trimmed)) {
        entries.push({ title: "Abstract", pageNumber, level: 1 });
        continue;
      }

      // Match "References" or "Bibliography"
      if (/^(references|bibliography)$/i.test(trimmed)) {
        entries.push({ title: trimmed, pageNumber, level: 1 });
        continue;
      }

      // Match "Appendix A" or "Appendix" etc
      if (/^appendix(\s+[a-z])?/i.test(trimmed) && trimmed.length < 60) {
        entries.push({ title: trimmed, pageNumber, level: 1 });
        continue;
      }

      // Match numbered sections: "1 Introduction", "2. Method", "3.1 Data"
      const sectionMatch = trimmed.match(
        /^(\d+(?:\.\d+)?)\s*\.?\s+([A-Z][A-Za-z\s,&:()-]{2,80})$/
      );
      if (sectionMatch) {
        const num = sectionMatch[1];
        const title = sectionMatch[2].trim();
        const level = num.includes(".") ? 2 : 1;
        entries.push({ title: `${num}. ${title}`, pageNumber, level });
        continue;
      }

      // Match Roman numeral sections: "I. Introduction", "II. Related Work"
      const romanMatch = trimmed.match(
        /^(I{1,3}|IV|V|VI{0,3}|IX|X{0,3})\.?\s+([A-Z][A-Za-z\s,&:()-]{2,80})$/
      );
      if (romanMatch) {
        const title = `${romanMatch[1]}. ${romanMatch[2].trim()}`;
        entries.push({ title, pageNumber, level: 1 });
      }
    }
  }

  return entries;
}

interface TableOfContentsProps {
  entries: TocEntry[];
  currentPage: number;
  onNavigate: (pageNumber: number) => void;
}

export default function TableOfContents({
  entries,
  currentPage,
  onNavigate,
}: TableOfContentsProps) {
  const grouped = useMemo(() => entries, [entries]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-4">
        <List className="size-5 text-muted-foreground/30 mb-2" strokeWidth={1.5} />
        <p className="text-xs text-muted-foreground">
          No sections detected in this paper.
        </p>
      </div>
    );
  }

  return (
    <nav className="py-2 px-1" aria-label="Table of contents">
      <div className="space-y-0.5">
        {grouped.map((entry, i) => {
          const isActive = entry.pageNumber === currentPage;
          const isPast = entry.pageNumber < currentPage;
          return (
            <button
              key={`${entry.pageNumber}-${i}`}
              type="button"
              onClick={() => onNavigate(entry.pageNumber)}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150",
                entry.level === 2 ? "pl-5" : "",
                isActive
                  ? "bg-primary/8 text-foreground font-medium"
                  : isPast
                    ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    : "text-foreground/75 hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="flex-1 leading-snug line-clamp-2">
                {entry.title}
              </span>
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                {entry.pageNumber}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
