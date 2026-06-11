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
  hasPageMapAnchors,
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
  /**
   * Progress of the in-flight page-map fetch as `{ done, total }` page calls.
   * Null when no fetch is active (cache hit, long paper, or not started).
   */
  pageMapProgress: { done: number; total: number } | null;
  /**
   * Error message from the most recent page-map fetch attempt. Set when the
   * LLM call (or any step before the result is cached) fails. Chat still
   * works in this state — citation chips fall back to regex resolution —
   * but the UI should surface it so the user knows why links degraded.
   */
  pageMapError: string | null;
  /** Scroll the PDF viewer to the given (1-based) page. Falls back to no-op. */
  scrollToPage: (
    page: number,
    anchorText?: string | string[],
    anchorBlock?: "start" | "center",
  ) => void;
}

const noop = () => {};

/**
 * Lowercase and strip everything except letters/digits. Aggressive on
 * purpose: PDF text extraction often inserts stray spaces inside ligatures
 * ("Effi cient" instead of "Efficient") and breaks words across lines, so
 * a forgiving comparator avoids spurious mismatches.
 */
function normalizeForTitleMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const Ctx = createContext<CitationContextValue>({
  parsedPaper: null,
  pageMap: null,
  paperText: null,
  parseReady: true,
  pageMapProgress: null,
  pageMapError: null,
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
  /**
   * Fires once the parsed paper resolves with a non-empty title — used by
   * the review page to replace a placeholder title (e.g. `arXiv:<id>` when
   * the metadata fetch failed) with the LLM-derived title.
   */
  onResolvedTitle?: (title: string) => void;
  /**
   * True while the viewer is still fetching/parsing the PDF and extracting
   * text. Surfaces the "Preparing paper for chat" banner during that phase
   * too, not only during the LLM-side parse that follows.
   */
  paperLoading?: boolean;
  children: ReactNode;
}

export function CitationContextProvider({
  paperText,
  selectedModel,
  onResolvedTitle,
  paperLoading,
  children,
}: ProviderProps) {
  const [parsedPaper, setParsedPaper] = useState<ParsedPaper | null>(null);
  const [pageMap, setPageMap] = useState<PageMap | null>(null);
  const [pageMapProgress, setPageMapProgress] = useState<
    { done: number; total: number } | null
  >(null);
  const [pageMapError, setPageMapError] = useState<string | null>(null);
  // Failsafe: unlock chat after 40s even if parsing hasn't finished. Parse
  // keeps running in the background and the cache picks it up once ready;
  // chat falls back to sending full paper text in the meantime. Track the
  // paper text that timed out (rather than a boolean) so it auto-resets on
  // paper change — avoids a synchronous setState in the effect body.
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null);

  useEffect(() => {
    if (!paperText) return;
    const id = window.setTimeout(() => setTimedOutFor(paperText), 40000);
    return () => window.clearTimeout(id);
  }, [paperText]);

  // Debug: paper length and page-map/full-parse mode.
  // useEffect(() => {
  //   if (!paperText || process.env.NODE_ENV !== "development") return;
  //   const threshold = PAGE_MAP_MAX_CHARS;
  //   const mode =
  //     paperText.length >= threshold
  //       ? "parsed-paper path; page-map skipped"
  //       : "LLM page-map path";
  //   console.log(
  //     `[citations] extracted paper length: ${paperText.length.toLocaleString()} chars; threshold: ${threshold.toLocaleString()}; mode: ${mode}`,
  //   );
  // }, [paperText]);

  // Notify the host when a non-empty title becomes available — long papers
  // get it from the full parse, short papers from the page-map call. The
  // substring check against the first 1000 chars of paper text is a cheap
  // hallucination guard: an LLM that invented a title (paper missing, very
  // short text, etc.) won't pass it and we keep the placeholder.
  useEffect(() => {
    const candidate =
      parsedPaper?.title?.trim() || pageMap?.title?.trim() || "";
    if (!candidate || !paperText) return;
    const needle = normalizeForTitleMatch(candidate);
    if (needle.length < 4) return;
    const haystack = normalizeForTitleMatch(paperText.slice(0, 1000));
    if (!haystack.includes(needle)) return;
    onResolvedTitle?.(candidate);
  }, [parsedPaper, pageMap, paperText, onResolvedTitle]);

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
        if (!cancelled) {
          setPageMap(null);
          setPageMapProgress(null);
          setPageMapError(null);
        }
        return;
      }
      // Long papers already get a full parse with `startPage` per section;
      // skip the dedicated page-map LLM call to avoid duplicating cost.
      if (paperText.length >= PAGE_MAP_MAX_CHARS) {
        if (!cancelled) {
          setPageMap(null);
          setPageMapProgress(null);
          setPageMapError(null);
        }
        return;
      }
      if (!cancelled) setPageMapError(null);
      try {
        const hash = await hashPaperText(paperText);
        const cached = await getCachedPageMap(hash);
        if (cached && (hasPageMapAnchors(cached) || !selectedModel)) {
          if (!cancelled) {
            setPageMap(cached);
            setPageMapProgress(null);
            // Debug: inspect cached page map.
            // if (process.env.NODE_ENV === "development") {
            //   console.log("[citations] loaded cached LLM page map", cached);
            // }
          }
          return;
        }
        if (!selectedModel) return;
        const creds = resolveModelCredentials();
        const fresh = await fetchAndCachePageMap(
          paperText,
          { apiKey: creds.apiKey },
          (done, total) => {
            if (!cancelled) setPageMapProgress({ done, total });
          },
        );
        if (!cancelled) {
          setPageMap(fresh);
          setPageMapProgress(null);
          // Debug: inspect freshly generated page map.
          // if (process.env.NODE_ENV === "development") {
          //   console.log("[citations] fetched LLM page map", fresh);
          // }
        }
      } catch (err) {
        // Chip resolution falls back to regex / parsed paper, but we surface
        // the failure so the user knows why citations are degraded and isn't
        // left staring at the "Preparing paper" banner until the 40s failsafe.
        if (!cancelled) {
          setPageMapProgress(null);
          setPageMapError(
            err instanceof Error ? err.message : "Page index unavailable.",
          );
        }
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
    const creds = resolveModelCredentials();

    let cancelled = false;
    void parseAndCachePaper(paperText, { apiKey: creds.apiKey })
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
    if (paperLoading) return false;
    if (!paperText) return true;
    if (!selectedModel) return true;
    if (timedOutFor === paperText) return true;
    if (isLongPaper(paperText)) return parsedPaper !== null;
    // Page-map failure is terminal: unlock chat in degraded mode rather than
    // sitting on the banner until the 40s failsafe. The user sees the error
    // and can still chat — citations just fall back to regex resolution.
    if (pageMapError) return true;
    return pageMap !== null;
  }, [
    paperLoading,
    paperText,
    selectedModel,
    parsedPaper,
    pageMap,
    pageMapError,
    timedOutFor,
  ]);

  const scrollToPage = useCallback(
    (page: number, anchorText?: string | string[], anchorBlock: "start" | "center" = "start") => {
      const container = document.querySelector("[data-pdf-container]");
      if (!container) return;
      const target = container.querySelector(
        `[data-page-number="${page}"]`,
      ) as HTMLElement | null;
      if (!target) return;
      // Prefer the exact spot: find the heading/caption text inside the page's
      // text layer and scroll to that element. Falls back to centering the
      // whole page when the text isn't found (text layer not rendered yet, or
      // extraction/render mismatch).
      const anchor = anchorText ? findAnchorElement(target, anchorText) : null;
      // `anchorBlock` controls where the anchor lands: "start" for section
      // headings (content reads downward from them, with a small margin so
      // the heading isn't flush against the edge), "center" for figure/table
      // captions (the content sits ABOVE the caption, so centering keeps it
      // in view). Page-level fallback always centers.
      if (anchor) anchor.style.scrollMarginTop = "19px";
      (anchor ?? target).scrollIntoView({
        behavior: "smooth",
        block: anchor ? anchorBlock : "center",
      });
      target.classList.add("page-flash");
      window.setTimeout(() => target.classList.remove("page-flash"), 1100);
    },
    [],
  );

  const value = useMemo(
    () => ({
      parsedPaper,
      pageMap,
      paperText: paperText ?? null,
      parseReady,
      pageMapProgress,
      pageMapError,
      scrollToPage,
    }),
    [
      parsedPaper,
      pageMap,
      paperText,
      parseReady,
      pageMapProgress,
      pageMapError,
      scrollToPage,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCitationContext(): CitationContextValue {
  return useContext(Ctx);
}

/**
 * Find the element in `pageEl`'s text layer whose text contains
 * `anchorText`. PDF text layers split a line into arbitrary spans (a heading
 * may render as ["3.2", " Experimental", " Setup"]), so we match against the
 * whitespace-stripped concatenation of all the layer's text nodes and map
 * the hit back to the node holding its first character.
 */
function findAnchorElement(
  pageEl: HTMLElement,
  anchorText: string | string[],
): HTMLElement | null {
  const layer = pageEl.querySelector(".textLayer");
  if (!layer) return null;
  const needles = (Array.isArray(anchorText) ? anchorText : [anchorText])
    .map((candidate) => candidate.toLowerCase().replace(/\s+/g, "").slice(0, 60))
    .filter((candidate) => candidate.length >= 4);
  if (needles.length === 0) return null;

  let haystack = "";
  const owners: HTMLElement[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase().replace(/\s+/g, "");
    const owner = node.parentElement;
    if (!text || !owner) continue;
    for (let i = 0; i < text.length; i++) owners.push(owner);
    haystack += text;
  }

  for (const needle of needles) {
    const idx = haystack.indexOf(needle);
    if (idx >= 0) return owners[idx] ?? null;
  }
  return null;
}
