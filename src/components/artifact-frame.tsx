"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  buildArtifactDocument,
  collectThemeCss,
  FRAME_CHANNEL,
  prepareArtifactBody,
  type FrameMessage,
  type HostMessage,
} from "@/lib/artifact-frame";
import type { CitationKind } from "@/lib/citation-transform";
import { useCitationNavigator } from "./citation-chip";

const CITE_KINDS = new Set<CitationKind>(["section", "figure", "table", "ref"]);
/** Tallest the frame grows; guards against pages sized in vh. */
const MAX_HEIGHT = 20_000;
/** Before the page reports its height. */
const INITIAL_HEIGHT = 160;

/** Chips in a prepared body, as `kind:value` keys. */
function citationKeys(body: string): Array<{ kind: CitationKind; value: string }> {
  const out: Array<{ kind: CitationKind; value: string }> = [];
  const re = /data-cite-kind="(\w+)" data-cite-value="([^"]*)"/g;
  for (const m of body.matchAll(re)) {
    const value = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    if (CITE_KINDS.has(m[1] as CitationKind)) {
      out.push({ kind: m[1] as CitationKind, value });
    }
  }
  return out;
}

/** Nearest scrolling ancestor, to bring a changed part into view. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

/**
 * Runs an artifact page in the sandbox (see artifact-frame.ts) and speaks the
 * bridge: sizes the frame to the page, routes paper-reference chips to the
 * PDF, hands `artifact.ask` prompts and state saves to the parent, and plays
 * the "what changed" highlight. A page that navigates itself away is
 * replaced with a notice; nothing it loads after that is shown.
 */
export function ArtifactFrame({
  html,
  state,
  readOnly,
  highlight,
  onAsk,
  onStateChange,
  title,
}: {
  html: string;
  /** Reader state the page starts from (read once per page load). */
  state: unknown;
  /** Viewing an older version: state saves are ignored. */
  readOnly?: boolean;
  /** Paths to highlight once loaded (changedPaths of prepared bodies). */
  highlight?: number[][] | null;
  onAsk?: (prompt: string) => void;
  onStateChange?: (state: unknown) => void;
  title: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [navigatedAway, setNavigatedAway] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const { resolve, navigate } = useCitationNavigator();

  // Client-only work (DOMParser, live stylesheets); SSR renders an empty frame.
  const body = useMemo(
    () => (typeof window === "undefined" ? "" : prepareArtifactBody(html)),
    [html],
  );
  // State is read when the page loads; later saves come from the page itself
  // and must not reload it. Parents key the frame per version, so a new
  // version remounts with fresh state.
  const stateRef = useRef(state);
  const srcDoc = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : buildArtifactDocument({
        body,
        themeCss: collectThemeCss(),
        state: stateRef.current,
        fontOrigin: window.location.origin,
      }),
    [body],
  );

  // A new page: reset what the last one reported. State adjusted during
  // render (guarded), React's alternative to an effect.
  const [loadedDoc, setLoadedDoc] = useState(srcDoc);
  if (loadedDoc !== srcDoc) {
    setLoadedDoc(srcDoc);
    setNavigatedAway(false);
    setScriptError(null);
  }
  const loadsRef = useRef(0);
  useEffect(() => {
    loadsRef.current = 0;
  }, [srcDoc]);

  const post = (msg: HostMessage) =>
    ref.current?.contentWindow?.postMessage({ ...msg, channel: FRAME_CHANNEL }, "*");

  // Latest values for the long-lived listener below.
  const live = useRef({ onAsk, onStateChange, readOnly, navigate, highlight });
  useEffect(() => {
    live.current = { onAsk, onStateChange, readOnly, navigate, highlight };
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = ref.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const msg = e.data as (FrameMessage & { channel?: string }) | null;
      if (!msg || msg.channel !== FRAME_CHANNEL) return;
      const { onAsk, onStateChange, readOnly, navigate } = live.current;
      switch (msg.type) {
        case "resize":
          if (Number.isFinite(msg.height)) {
            setHeight(Math.min(MAX_HEIGHT, Math.max(40, Math.ceil(msg.height))));
          }
          break;
        case "cite":
          if (CITE_KINDS.has(msg.kind as CitationKind) && typeof msg.value === "string") {
            navigate({ kind: msg.kind as CitationKind, value: msg.value.slice(0, 200) });
          }
          break;
        case "ask":
          if (typeof msg.prompt === "string" && msg.prompt.trim()) {
            onAsk?.(msg.prompt.trim().slice(0, 2000));
          }
          break;
        case "state":
          if (!readOnly) onStateChange?.(msg.state ?? null);
          break;
        case "scroll": {
          const scroller = scrollParent(frame);
          if (!scroller || !Number.isFinite(msg.top)) break;
          const offset =
            frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          scroller.scrollTo({
            top: scroller.scrollTop + offset + msg.top - 48,
            behavior: "smooth",
          });
          break;
        }
        case "error":
          if (typeof msg.message === "string") setScriptError(msg.message.slice(0, 300));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Tell the page which chips can't be placed in this paper.
  const citations = useMemo(() => citationKeys(body), [body]);
  const citationStatus = (() => {
    const unresolved: string[] = [];
    const tooltips: Record<string, string> = {};
    for (const c of citations) {
      const key = `${c.kind}:${c.value}`;
      const r = resolve(c);
      if (!r.page) unresolved.push(key);
      if (r.tooltip) tooltips[key] = r.tooltip;
    }
    return { unresolved, tooltips };
  })();
  const citationKey = JSON.stringify(citationStatus);
  useEffect(() => {
    post({ type: "citations", ...citationStatus });
    // Re-sent when resolution changes (e.g. the paper finishes parsing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citationKey]);

  const highlightKey = JSON.stringify(highlight ?? null);
  useEffect(() => {
    if (highlight && highlight.length > 0 && loadsRef.current > 0) {
      post({ type: "highlight", paths: highlight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey]);

  const onLoad = () => {
    loadsRef.current += 1;
    // srcdoc loads once; a second load means the page navigated itself.
    if (loadsRef.current > 1) {
      setNavigatedAway(true);
      return;
    }
    post({ type: "citations", ...citationStatus });
    const h = live.current.highlight;
    if (h && h.length > 0) post({ type: "highlight", paths: h });
  };

  if (navigatedAway) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3.5 py-3 text-[12.5px] leading-[1.55] text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          This artifact tried to load another page, so it was stopped. Ask the
          assistant to rebuild it.
        </span>
      </div>
    );
  }

  return (
    <div>
      <iframe
        ref={ref}
        title={title}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onLoad={onLoad}
        referrerPolicy="no-referrer"
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
      {scriptError ? (
        <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
          A script in this artifact failed ({scriptError}).{" "}
          {onAsk ? (
            <button
              type="button"
              onClick={() =>
                onAsk(`Fix the script error in this artifact: ${scriptError}`)
              }
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Ask to fix it
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
