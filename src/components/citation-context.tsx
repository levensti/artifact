"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getCachedParsedPaper,
  hashPaperText,
} from "@/lib/client/parsed-papers";
import type { ParsedPaper } from "@/lib/review-types";

interface CitationContextValue {
  parsedPaper: ParsedPaper | null;
  /** Raw extracted paper text — used as a fallback resolver when parsedPaper isn't available. */
  paperText: string | null;
  /** Scroll the PDF viewer to the given (1-based) page. Falls back to no-op. */
  scrollToPage: (page: number) => void;
}

const noop = () => {};

const Ctx = createContext<CitationContextValue>({
  parsedPaper: null,
  paperText: null,
  scrollToPage: noop,
});

interface ProviderProps {
  paperText: string | null | undefined;
  children: ReactNode;
}

/**
 * Provides citation-resolution context to the chat. Loads the cached
 * `ParsedPaper` for the current paper (if one was parsed previously by
 * the chat hook) and exposes a `scrollToPage` callback that targets the
 * PDF viewer. No-ops cleanly when the paper hasn't been parsed.
 */
export function CitationContextProvider({
  paperText,
  children,
}: ProviderProps) {
  const [parsedPaper, setParsedPaper] = useState<ParsedPaper | null>(null);

  // Load cached parsed paper whenever the paper text changes. Re-checks
  // the cache periodically so a parse triggered mid-chat picks up here too.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!paperText) {
        if (!cancelled) setParsedPaper(null);
        return;
      }
      try {
        const hash = await hashPaperText(paperText);
        const cached = await getCachedParsedPaper(hash);
        if (!cancelled) setParsedPaper(cached);
      } catch {
        /* ignore — citations degrade to no-hover/no-jump */
      }
    };

    void load();
    if (!paperText) return;
    // Recheck every 5s so a long-paper parse triggered by the chat hook
    // becomes visible without a full reload.
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [paperText]);

  const scrollToPage = useCallback((page: number) => {
    const container = document.querySelector("[data-pdf-container]");
    if (!container) return;
    const target = container.querySelector(
      `[data-page-number="${page}"]`,
    ) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // Always pulse the page so the click feels responsive — when the page
    // is already in view, smooth-scroll-to-self is silent and users think
    // nothing happened.
    target.classList.add("page-flash");
    window.setTimeout(() => target.classList.remove("page-flash"), 1100);
  }, []);

  const value = useMemo(
    () => ({ parsedPaper, paperText: paperText ?? null, scrollToPage }),
    [parsedPaper, paperText, scrollToPage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCitationContext(): CitationContextValue {
  return useContext(Ctx);
}
