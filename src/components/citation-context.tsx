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
  isLongPaper,
  parseAndCachePaper,
} from "@/lib/client/parsed-papers";
import {
  fetchAndCachePageMap,
  getCachedPageMap,
  PAGE_MAP_MAX_CHARS,
} from "@/lib/client/page-maps";
import { resolveModelCredentials } from "@/lib/keys";
import type { Model } from "@/lib/models";
import type { PageMap, ParsedPaper } from "@/lib/review-types";

interface CitationContextValue {
  parsedPaper: ParsedPaper | null;
  /** LLM-derived map from citation tokens to PDF page numbers. */
  pageMap: PageMap | null;
  /** Raw extracted paper text — used as a fallback resolver when parsedPaper isn't available. */
  paperText: string | null;
  /**
   * True once the parse the chat depends on is loaded — full parse for long
   * papers, page map for short ones. Also true when there's no paper or no
   * model selected (nothing to wait for); the chat handles those states.
   */
  parseReady: boolean;
  /** Scroll the PDF viewer to the given (1-based) page. Falls back to no-op. */
  scrollToPage: (page: number) => void;
}

const noop = () => {};

const Ctx = createContext<CitationContextValue>({
  parsedPaper: null,
  pageMap: null,
  paperText: null,
  parseReady: true,
  scrollToPage: noop,
});

interface ProviderProps {
  paperText: string | null | undefined;
  /**
   * The selected chat model — needed to call the page-map LLM endpoint.
   * Optional: when absent, we still serve cached page maps but won't
   * trigger a fresh fetch (chip clicks just degrade to the regex fallback).
   */
  selectedModel?: Model | null;
  children: ReactNode;
}

export function CitationContextProvider({
  paperText,
  selectedModel,
  children,
}: ProviderProps) {
  const [parsedPaper, setParsedPaper] = useState<ParsedPaper | null>(null);
  const [pageMap, setPageMap] = useState<PageMap | null>(null);

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
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [paperText]);

  // Fetch (or load cached) page map whenever paper text changes. Runs for
  // any paper, regardless of length — short papers especially benefit
  // since they have no `parsedPaper` to fall back on.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!paperText) {
        if (!cancelled) setPageMap(null);
        return;
      }
      // Long papers already get a full parse with `startPage` per section;
      // skip the dedicated page-map LLM call to avoid duplicating cost.
      if (paperText.length >= PAGE_MAP_MAX_CHARS) {
        if (!cancelled) setPageMap(null);
        return;
      }
      try {
        const hash = await hashPaperText(paperText);
        const cached = await getCachedPageMap(hash);
        if (cached) {
          if (!cancelled) setPageMap(cached);
          return;
        }
        if (!selectedModel) return;
        const creds = resolveModelCredentials(selectedModel);
        if (!creds) return;
        const fresh = await fetchAndCachePageMap(paperText, {
          model: selectedModel.modelId,
          provider: selectedModel.provider,
          apiKey: creds.apiKey,
          apiBaseUrl: creds.apiBaseUrl,
        });
        if (!cancelled) setPageMap(fresh);
      } catch {
        /* ignore — chip resolution falls back to regex / parsed paper */
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [paperText, selectedModel]);

  // Eagerly kick off the full parse for long papers when the paper text and
  // credentials are available. Without this the parse only fires lazily on
  // first chat submit, which would deadlock a chat-loading gate.
  useEffect(() => {
    if (!paperText || !isLongPaper(paperText)) return;
    if (parsedPaper) return;
    if (!selectedModel) return;
    const creds = resolveModelCredentials(selectedModel);
    if (!creds) return;

    let cancelled = false;
    void parseAndCachePaper(paperText, {
      model: selectedModel.modelId,
      provider: selectedModel.provider,
      apiKey: creds.apiKey,
      apiBaseUrl: creds.apiBaseUrl,
    })
      .then((parsed) => {
        if (!cancelled) setParsedPaper(parsed);
      })
      .catch(() => {
        /* polling above will re-check the cache; chat falls back if it never arrives */
      });
    return () => {
      cancelled = true;
    };
  }, [paperText, selectedModel, parsedPaper]);

  const parseReady = useMemo(() => {
    if (!paperText) return true;
    if (!selectedModel) return true;
    if (isLongPaper(paperText)) return parsedPaper !== null;
    return pageMap !== null;
  }, [paperText, selectedModel, parsedPaper, pageMap]);

  const scrollToPage = useCallback((page: number) => {
    const container = document.querySelector("[data-pdf-container]");
    if (!container) return;
    const target = container.querySelector(
      `[data-page-number="${page}"]`,
    ) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("page-flash");
    window.setTimeout(() => target.classList.remove("page-flash"), 1100);
  }, []);

  const value = useMemo(
    () => ({
      parsedPaper,
      pageMap,
      paperText: paperText ?? null,
      parseReady,
      scrollToPage,
    }),
    [parsedPaper, pageMap, paperText, parseReady, scrollToPage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCitationContext(): CitationContextValue {
  return useContext(Ctx);
}
