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
  fetchAndCachePageMap,
  getCachedPageMap,
  hasPageMapAnchors,
  PAGE_MAP_MAX_CHARS,
} from "@/lib/client/page-maps";
import {
  getDocumentSections,
  getDocumentStatus,
  hashPaperText,
  isDocumentIndexing,
  isDocumentReady,
  registerDocument,
  sectionsToPageMap,
  type DocumentStatus,
  type ReviewDocument,
} from "@/lib/client/documents";
import { resolveModelCredentials } from "@/lib/keys";
import type { DocumentOutlineEntry } from "@/lib/documents";
import type { PageMap } from "@/lib/review-types";

interface CitationContextValue {
  /** LLM-derived map from citation tokens to PDF page numbers. */
  pageMap: PageMap | null;
  /** Raw extracted paper text — the fallback resolver when the page map has no entry. */
  paperText: string | null;
  /**
   * Server-side document record for `paperText` (content-hashed, shared
   * across readers). Null until registration completes. Chat sends only
   * `documentStatus.hash`; long documents also wait on `indexStatus`.
   */
  documentStatus: DocumentStatus | null;
  /**
   * Which step chat is waiting on while `parseReady` is false: extracting
   * text in the browser, registering the document with the server, or
   * indexing it (chat reads documents only through retrieval; progress is
   * `documentStatus.indexProgress`). Null when ready. `registration_failed`
   * keeps chat locked until the failsafe, with the error in
   * `registrationError`; `index_failed` keeps it locked until a reload
   * retries, with the error in `documentStatus.indexError`.
   */
  preparingPhase:
    | "extracting"
    | "registering"
    | "indexing"
    | "registration_failed"
    | "index_failed"
    | null;
  registrationError: string | null;
  /**
   * True once the document's index is ready, so chat can retrieve from it.
   * Also true when there's no paper or no model selected (nothing to wait
   * for); the chat handles those states.
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
  pageMap: null,
  paperText: null,
  documentStatus: null,
  preparingPhase: null,
  registrationError: null,
  parseReady: true,
  pageMapProgress: null,
  pageMapError: null,
  scrollToPage: noop,
});

interface ProviderProps {
  paperText: string | null | undefined;
  /** PDF outline captured with the text; feeds server-side section detection. */
  paperOutline?: DocumentOutlineEntry[] | null;
  /** Review to link to the document on registration. */
  reviewId?: string;
  /**
   * Server copy of the document (status + sections) when the review was
   * opened before. Skips the registration upload; `paperText` is then the
   * stored text the host already set.
   */
  preloaded?: ReviewDocument | null;
  /** Title hint stored on first registration (the parse/page map refine it). */
  paperTitle?: string;
  /**
   * Whether a usable provider is configured — needed to call the page-map LLM
   * endpoint. Optional: when false, we still serve cached page maps but won't
   * trigger a fresh fetch (chip clicks just degrade to the regex fallback).
   */
  modelReady?: boolean;
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
  paperOutline,
  reviewId,
  preloaded,
  paperTitle,
  modelReady,
  onResolvedTitle,
  paperLoading,
  children,
}: ProviderProps) {
  const [pageMap, setPageMap] = useState<PageMap | null>(null);
  const [pageMapProgress, setPageMapProgress] = useState<
    { done: number; total: number } | null
  >(null);
  const [pageMapError, setPageMapError] = useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatus | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  /** Page map synthesized from the server's section tree (long documents). */
  const [sectionPageMap, setSectionPageMap] = useState<PageMap | null>(null);
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
      pageMap?.title?.trim() || documentStatus?.title?.trim() || "";
    if (!candidate || !paperText) return;
    const needle = normalizeForTitleMatch(candidate);
    if (needle.length < 4) return;
    const haystack = normalizeForTitleMatch(paperText.slice(0, 1000));
    if (!haystack.includes(needle)) return;
    onResolvedTitle?.(candidate);
  }, [documentStatus, pageMap, paperText, onResolvedTitle]);

  // Register the document with the server as soon as the text is extracted,
  // then poll while a long document is being indexed. The outline is sent
  // along for section detection. Registration is idempotent per hash, so a
  // second reader of the same paper just links their review and gets the
  // existing index.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    setDocumentStatus(null);
    setSectionPageMap(null);
    setRegistrationError(null);
    if (!paperText) return;

    const poll = async (hash: string) => {
      const status = await getDocumentStatus(hash);
      if (cancelled) return;
      if (status) setDocumentStatus(status);
      if (isDocumentIndexing(status)) {
        timer = window.setTimeout(() => void poll(hash), 2000);
      }
    };

    const run = async () => {
      try {
        // Reopen: the server already has this document. Skip the upload and
        // use its status + sections directly, unless its index never got
        // built (queued or failed): registering again re-queues it, and chat
        // can't open without it.
        const indexMissing =
          preloaded?.status.indexStatus === "pending" ||
          preloaded?.status.indexStatus === "failed";
        if (preloaded && !indexMissing) {
          setDocumentStatus(preloaded.status);
          setSectionPageMap(sectionsToPageMap(preloaded.sections));
          if (isDocumentIndexing(preloaded.status)) {
            timer = window.setTimeout(() => void poll(preloaded.status.hash), 2000);
          }
          return;
        }
        const status = await registerDocument(paperText, {
          title: paperTitle,
          outline: paperOutline,
          reviewId,
          apiKey: resolveModelCredentials().apiKey || undefined,
        });
        if (cancelled) return;
        setDocumentStatus(status);
        if (isDocumentIndexing(status)) {
          timer = window.setTimeout(() => void poll(status.hash), 2000);
        }
        // Sections exist from registration on (no need to wait for the
        // index); they back §-chip resolution for long documents.
        const sections = await getDocumentSections(status.hash);
        if (!cancelled) setSectionPageMap(sectionsToPageMap(sections));
      } catch (err) {
        // Chat still works without a document (the server just has no paper
        // to put in context) once the failsafe unlocks it; surface the error
        // so the user isn't staring at a spinner with no explanation.
        console.warn("Document registration failed:", err);
        if (!cancelled) {
          setRegistrationError(err instanceof Error ? err.message : "Registration failed.");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // paperOutline / paperTitle / reviewId / preloaded arrive with the text;
    // keying on the text alone avoids re-registering on every title refinement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperText]);

  // Fetch (or load cached) page map whenever paper text changes. Runs for
  // any paper, regardless of length — short papers especially benefit
  // since § chips have nothing else to resolve against there.
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
        if (cached && (hasPageMapAnchors(cached) || !modelReady)) {
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
        if (!modelReady) return;
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
  }, [paperText, modelReady]);

  const preparingPhase = useMemo<CitationContextValue["preparingPhase"]>(() => {
    if (paperLoading) return "extracting";
    if (!paperText || !modelReady) return null;
    if (registrationError) return "registration_failed";
    if (!isDocumentReady(documentStatus)) return "registering";
    if (documentStatus?.indexStatus === "failed") return "index_failed";
    if (isDocumentIndexing(documentStatus)) return "indexing";
    return null;
  }, [paperLoading, paperText, modelReady, registrationError, documentStatus]);

  const parseReady = useMemo(() => {
    if (paperLoading) return false;
    if (!paperText) return true;
    if (!modelReady) return true;
    // Registration stuck or failed: the failsafe unlocks chat without the
    // paper rather than spinning forever.
    if (registrationError || !isDocumentReady(documentStatus)) {
      return timedOutFor === paperText;
    }
    // Chat reads the document only through retrieval, so it waits for the
    // index (no failsafe: a book can take minutes). The page map isn't a
    // gate; it loads in the background and only sharpens citation chips.
    return documentStatus?.indexStatus === "ready";
  }, [paperLoading, paperText, modelReady, timedOutFor, documentStatus, registrationError]);

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
      // The viewer only mounts pages near the viewport, so a far page has no
      // text layer yet. Jump to it, then settle on the anchor once it renders.
      if (anchorText && !anchor && !target.querySelector(".textLayer")) {
        target.scrollIntoView({ block: "center" });
        const mo = new MutationObserver(() => {
          const late = findAnchorElement(target, anchorText);
          if (!late) return;
          mo.disconnect();
          late.style.scrollMarginTop = "19px";
          late.scrollIntoView({ behavior: "smooth", block: anchorBlock });
        });
        mo.observe(target, { childList: true, subtree: true });
        window.setTimeout(() => mo.disconnect(), 3000);
        target.classList.add("page-flash");
        window.setTimeout(() => target.classList.remove("page-flash"), 1100);
        return;
      }
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

  const effectivePageMap = useMemo<PageMap | null>(() => {
    if (!sectionPageMap) return pageMap;
    if (!pageMap) return sectionPageMap;
    return {
      ...pageMap,
      sections: { ...sectionPageMap.sections, ...pageMap.sections },
      anchors: {
        sections: { ...sectionPageMap.anchors?.sections, ...pageMap.anchors?.sections },
        figures: pageMap.anchors?.figures ?? {},
        tables: pageMap.anchors?.tables ?? {},
      },
    };
  }, [pageMap, sectionPageMap]);

  const value = useMemo(
    () => ({
      pageMap: effectivePageMap,
      paperText: paperText ?? null,
      documentStatus,
      preparingPhase,
      registrationError,
      parseReady,
      pageMapProgress,
      pageMapError,
      scrollToPage,
    }),
    [
      effectivePageMap,
      paperText,
      documentStatus,
      preparingPhase,
      registrationError,
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
