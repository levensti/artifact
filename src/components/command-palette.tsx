"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, MessageSquareQuote, BookOpen, X } from "lucide-react";
import type { SearchResult } from "@/lib/server/store";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/data/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data = (await res.json()) as SearchResult[];
          setResults(data);
          setSelectedIndex(0);
        }
      } catch {
        /* aborted or network error */
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      router.push(`/review/${result.reviewId}`);
      onClose();
    },
    [router, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    }
  };

  if (!open) return null;

  const iconForType = (type: SearchResult["type"]) => {
    switch (type) {
      case "review":
        return FileText;
      case "annotation":
        return MessageSquareQuote;
      case "prerequisite":
        return BookOpen;
    }
  };

  const labelForType = (type: SearchResult["type"]) => {
    switch (type) {
      case "review":
        return "Paper";
      case "annotation":
        return "Note";
      case "prerequisite":
        return "Prereq";
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-foreground/15 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="fixed left-1/2 top-[15%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-elevated), 0 20px 60px -15px rgb(0 0 0 / 0.15)" }}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search papers, notes, prerequisites..."
            className="flex-1 bg-transparent py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            Esc
          </kbd>
        </div>

        {results.length > 0 && (
          <div className="max-h-[360px] overflow-y-auto py-1.5">
            {results.map((result, i) => {
              const Icon = iconForType(result.type);
              return (
                <button
                  key={`${result.type}-${result.reviewId}-${i}`}
                  type="button"
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors",
                    i === selectedIndex ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/50">
                    <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium leading-snug text-foreground line-clamp-1">
                      {result.text}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                      <span className="font-medium">{labelForType(result.type)}</span>
                      {" in "}
                      {result.reviewTitle}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {query.length >= 2 && results.length === 0 && !loading && (
          <div className="py-8 text-center">
            <p className="text-xs text-muted-foreground">No results found</p>
          </div>
        )}

        {query.length < 2 && (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">
              Type to search across all your papers and notes
            </p>
          </div>
        )}
      </div>
    </>
  );
}
