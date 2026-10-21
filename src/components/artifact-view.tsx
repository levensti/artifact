"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  LayoutPanelTop,
  PencilLine,
  Undo2,
} from "lucide-react";
import {
  artifactRefFromOutput,
  CREATE_ARTIFACT_TOOL,
  type ReviewArtifact,
} from "@/lib/artifacts";
import { changedPaths, prepareArtifactBody } from "@/lib/artifact-frame";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";
import {
  fetchArtifactVersion,
  latestArtifactState,
  refreshArtifacts,
  restoreArtifact,
  saveArtifactState,
  splitArtifact,
} from "@/hooks/use-artifacts";
import { ArtifactFrame } from "./artifact-frame";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export interface OpenArtifactOptions {
  /** Play the "what changed" highlight for this version once it's shown
   *  (opened from an "Updated" card in the chat). */
  highlightVersion?: number;
}

/**
 * The review's artifacts and a way to open one in the Artifacts tab, next to
 * the PDF, so citation chips can scroll the paper while the artifact stays in
 * view. Provided by RightPanel; null where there's no panel to open into.
 */
export const ArtifactsContext = createContext<{
  reviewId: string;
  artifacts: ReviewArtifact[];
  loaded: boolean;
  open: (id: string, options?: OpenArtifactOptions) => void;
} | null>(null);

/* ------------------------------------------------------------------ */
/*  ArtifactCard: preview card that opens the artifact in its tab      */
/* ------------------------------------------------------------------ */

function cardDate(artifact: ReviewArtifact): string {
  if (artifact.version > 1) return `Edited ${formatRelative(artifact.updatedAt)}`;
  return new Date(artifact.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ArtifactCard({
  artifact,
  showDate,
  className,
}: {
  artifact: ReviewArtifact;
  /** Shown in the Artifacts tab list. */
  showDate?: boolean;
  className?: string;
}) {
  const ctx = useContext(ArtifactsContext);

  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card transition-colors hover:border-foreground/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => ctx?.open(artifact.id)}
        disabled={!ctx}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <LayoutPanelTop className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug tracking-[-0.005em] text-foreground">
            {artifact.title}
          </span>
          {artifact.summary ? (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.5] text-muted-foreground">
              {artifact.summary}
            </span>
          ) : null}
          {showDate ? (
            <span className="mt-1 block text-[11px] text-muted-foreground/70">
              {cardDate(artifact)}
            </span>
          ) : null}
        </span>
        <ChevronRight
          className="mt-1 size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ArtifactChatCard: what a create/update call shows in the chat      */
/* ------------------------------------------------------------------ */

/**
 * The chat's view of a create_artifact or update_artifact call, found by the
 * ref in its output (or, for turns saved before refs, by call id). An edit
 * shows what changed with Undo and "Keep as separate", so the model can pick
 * edit-in-place on its own and a wrong guess costs one click. Rendered only
 * for calls that saved (see savedArtifactCall in chat-step-renderers).
 */
export function ArtifactChatCard({
  callId,
  name,
  input,
  output,
}: {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
}) {
  const ctx = useContext(ArtifactsContext);
  // Turns saved before refs existed match by call id instead.
  const ref = artifactRefFromOutput(output);
  const artifact = ctx?.artifacts.find((a) =>
    ref ? a.id === ref.id : a.sourceCallId === callId,
  );

  // The tool saved while the turn runs; fetch the list once if this card is
  // ahead of it.
  const behind = !!ctx?.loaded && !!ref && (!artifact || artifact.version < ref.version);
  const refreshed = useRef(false);
  useEffect(() => {
    if (behind && ctx && !refreshed.current) {
      refreshed.current = true;
      refreshArtifacts(ctx.reviewId);
    }
  }, [behind, ctx]);

  if (!artifact) {
    if (!ctx?.loaded || behind) return null;
    const title = typeof input.title === "string" ? input.title : "An artifact";
    return (
      <div className="my-2 flex items-center gap-3 rounded-lg border border-dashed border-border px-3.5 py-2.5 text-[12px] text-muted-foreground">
        <LayoutPanelTop className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground/80">{title}</span> was
          made here. Artifacts aren&rsquo;t included in shared reviews.
        </span>
      </div>
    );
  }

  if (name === CREATE_ARTIFACT_TOOL) {
    return <ArtifactCard artifact={artifact} className="my-2" />;
  }
  const version = ref?.version ?? artifact.version;
  const change = typeof input.change === "string" ? input.change : "Edited";
  return (
    <ArtifactUpdateCard
      artifact={artifact}
      version={version}
      change={change}
      reviewId={ctx!.reviewId}
      onOpen={() => ctx?.open(artifact.id, { highlightVersion: version })}
      onOpenOther={(id) => ctx?.open(id)}
    />
  );
}

function ArtifactUpdateCard({
  artifact,
  version,
  change,
  reviewId,
  onOpen,
  onOpenOther,
}: {
  artifact: ReviewArtifact;
  version: number;
  change: string;
  reviewId: string;
  onOpen: () => void;
  onOpenOther: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"undone" | "split" | null>(null);
  // Undo and split act on the edit only while it's still the latest version.
  const isLatest = artifact.version === version && version > 1;

  const run = async (action: "undo" | "split") => {
    setBusy(true);
    try {
      if (action === "undo") {
        await restoreArtifact(reviewId, artifact.id, version - 1);
        setDone("undone");
      } else {
        const id = await splitArtifact(reviewId, artifact.id, version);
        setDone("split");
        onOpenOther(id);
      }
    } catch (e) {
      console.error("Artifact action failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const action =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";

  return (
    <div className="group my-2 rounded-lg border border-border bg-card transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 px-3.5 pb-1.5 pt-3 text-left"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <PencilLine className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug tracking-[-0.005em] text-foreground">
            Updated <span className="font-semibold">{artifact.title}</span>
          </span>
          <span className="mt-0.5 block text-[12px] leading-[1.5] text-muted-foreground">
            {change}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
          v{version}
        </span>
      </button>
      <div className="flex items-center gap-1 pb-2 pl-[52px] pr-3">
        {done === "undone" ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
            <Check className="size-3" strokeWidth={2.25} aria-hidden />
            Undone
          </span>
        ) : done === "split" ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
            <Check className="size-3" strokeWidth={2.25} aria-hidden />
            Kept as a separate artifact
          </span>
        ) : isLatest ? (
          <>
            <button type="button" className={action} disabled={busy} onClick={() => run("undo")}>
              <Undo2 className="size-3" strokeWidth={2} aria-hidden />
              Undo
            </button>
            <button type="button" className={action} disabled={busy} onClick={() => run("split")}>
              <Copy className="size-3" strokeWidth={2} aria-hidden />
              Keep as separate artifact
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ArtifactDetail: one artifact, open in the Artifacts tab            */
/* ------------------------------------------------------------------ */

/** Debounce for saving reader state from the page. */
const STATE_SAVE_MS = 800;

/** Paths that changed from one version's source to another's, in the
 *  prepared form the frame renders. */
function diffPaths(prev: string, next: string): number[][] {
  return changedPaths(prepareArtifactBody(prev), prepareArtifactBody(next));
}

/**
 * The open artifact, filling the Artifacts tab beside the PDF. Shows any
 * version (the latest by default) with a quiet version line under the title,
 * highlights what changed when an edit lands, and has a composer at the
 * bottom so questions and change requests go to the assistant from here.
 */
export function ArtifactDetail({
  reviewId,
  artifact,
  highlightVersion,
  onBack,
  onSend,
  chatBusy,
  onViewChat,
}: {
  reviewId: string;
  artifact: ReviewArtifact;
  /** Highlight what this version changed when it's showing. */
  highlightVersion?: number;
  onBack: () => void;
  /** Send a message to the assistant about this artifact. */
  onSend: (text: string) => void;
  /** The assistant is replying, so the composer waits. */
  chatBusy: boolean;
  onViewChat: () => void;
}) {
  // null shows the latest version.
  const [viewing, setViewing] = useState<number | null>(null);
  const shown = viewing ?? artifact.version;
  const isLatest = shown === artifact.version;

  // Older versions' source, fetched on demand.
  const [oldHtml, setOldHtml] = useState<{ version: number; html: string } | null>(null);
  useEffect(() => {
    if (isLatest) return;
    let cancelled = false;
    void fetchArtifactVersion(reviewId, artifact.id, shown)
      .then((html) => {
        if (!cancelled) setOldHtml({ version: shown, html });
      })
      .catch((e) => console.error("Failed to load version:", e));
    return () => {
      cancelled = true;
    };
  }, [reviewId, artifact.id, shown, isLatest]);
  const html = isLatest
    ? artifact.html
    : oldHtml?.version === shown
      ? oldHtml.html
      : null;

  // "What changed": when a new version lands while this is open, or when
  // opened from an "Updated" card for the current version.
  const [highlight, setHighlight] = useState<{ version: number; paths: number[][] } | null>(
    null,
  );
  const seen = useRef({ id: artifact.id, version: artifact.version, html: artifact.html });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { id: artifact.id, version: artifact.version, html: artifact.html };
    if (prev.id === artifact.id && artifact.version > prev.version) {
      setViewing(null);
      setHighlight({ version: artifact.version, paths: diffPaths(prev.html, artifact.html) });
    }
  }, [artifact.id, artifact.version, artifact.html]);
  useEffect(() => {
    if (!highlightVersion || highlightVersion < 2 || highlightVersion !== artifact.version) {
      return;
    }
    let cancelled = false;
    void fetchArtifactVersion(reviewId, artifact.id, highlightVersion - 1).then((prev) => {
      if (!cancelled) {
        setHighlight({ version: highlightVersion, paths: diffPaths(prev, artifact.html) });
      }
    });
    return () => {
      cancelled = true;
    };
    // Once per open; a later edit is handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightVersion]);

  // Reader state: the page saves through the bridge; keep the latest here so
  // switching versions hands the page what the reader just did.
  const [state, setState] = useState<unknown>(() =>
    latestArtifactState(artifact.id, artifact.state),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStateChange = (next: unknown) => {
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveArtifactState(reviewId, artifact.id, next);
    }, STATE_SAVE_MS);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // Composer: typed questions send; artifact.ask() from the page only fills
  // it in, since a click inside the frame can't be verified as the reader's.
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefill = (prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  };
  const send = () => {
    const text = draft.trim();
    if (!text || chatBusy) return;
    onSend(text);
    setDraft("");
  };

  const meta = artifact.versions.find((v) => v.number === shown);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 pb-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          All artifacts
        </button>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {artifact.title}
        </h2>
        {artifact.summary ? (
          <p className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">
            {artifact.summary}
          </p>
        ) : null}
        {artifact.versions.length > 1 ? (
          <VersionLine
            versions={artifact.versions}
            shown={shown}
            latest={artifact.version}
            meta={meta}
            onShow={(n) => setViewing(n === artifact.version ? null : n)}
          />
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {!isLatest ? (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/90 px-4 py-1.5 text-[12px] backdrop-blur">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Viewing v{shown} of {artifact.version}
            </span>
            <button
              type="button"
              onClick={() => void restoreArtifact(reviewId, artifact.id, shown)}
              className="rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-background"
            >
              Restore
            </button>
            <span className="text-muted-foreground/50" aria-hidden>
              ·
            </span>
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-background"
            >
              Back to latest
            </button>
          </div>
        ) : null}
        <div className="px-4 py-4">
          {html !== null ? (
            <ArtifactFrame
              key={`${artifact.id}:${shown}`}
              title={artifact.title}
              html={html}
              state={state}
              readOnly={!isLatest}
              highlight={highlight?.version === shown ? highlight.paths : null}
              onAsk={prefill}
              onStateChange={onStateChange}
            />
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2.5">
        {chatBusy ? (
          <div className="flex items-center justify-between gap-2 px-1 text-[12px] text-muted-foreground">
            <span className="thinking-shimmer font-medium">Assistant is working…</span>
            <button
              type="button"
              onClick={onViewChat}
              className="rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
            >
              View in chat
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 focus-within:border-foreground/30">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about this, or ask for a change"
              aria-label="Ask about this artifact"
              className="max-h-28 min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-[1.45] outline-none [field-sizing:content] placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim()}
              aria-label="Send"
              className="mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `‹ v3 ›  Simplified the method section · 2m ago ⌄`: arrows step through
 * versions in place; the description opens the full history.
 */
function VersionLine({
  versions,
  shown,
  latest,
  meta,
  onShow,
}: {
  versions: ReviewArtifact["versions"];
  shown: number;
  latest: number;
  meta: ReviewArtifact["versions"][number] | undefined;
  onShow: (n: number) => void;
}) {
  const step =
    "flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="-ml-1 mt-2 flex min-w-0 items-center gap-0.5 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        className={step}
        disabled={shown <= 1}
        onClick={() => onShow(shown - 1)}
        aria-label="Previous version"
      >
        <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      <span className="font-mono tabular-nums text-foreground/80">v{shown}</span>
      <button
        type="button"
        className={step}
        disabled={shown >= latest}
        onClick={() => onShow(shown + 1)}
        aria-label="Next version"
      >
        <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="ml-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Version history"
        >
          <span className="truncate">
            {meta?.changeSummary ?? ""}
            {meta ? ` · ${formatRelative(meta.createdAt)}` : ""}
          </span>
          <ChevronDown className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          {versions.map((v) => (
            <DropdownMenuItem
              key={v.number}
              onClick={() => onShow(v.number)}
              className="items-start gap-2 py-1.5"
            >
              <span
                className={cn(
                  "mt-[5px] size-1.5 shrink-0 rounded-full",
                  v.number === shown ? "bg-primary" : "border border-muted-foreground/40",
                )}
                aria-hidden
              />
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                v{v.number}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                {v.changeSummary}
                {v.number === latest ? (
                  <span className="text-muted-foreground"> (current)</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelative(v.createdAt)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
