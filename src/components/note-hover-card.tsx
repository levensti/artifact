"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { type Annotation, updateAnnotation } from "@/lib/annotations";

/**
 * Screen-space (viewport) geometry of the highlight the card points at, plus
 * the reading column's edges so the card can dock into the margin beside the
 * line rather than over the prose.
 */
export interface HoverAnchor {
  /** The hovered highlight rect (the single line under the cursor). */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Left/right edges of the page (PDF) or content column (web). */
  colLeft: number;
  colRight: number;
}

interface NoteHoverCardProps {
  annotation: Annotation;
  reviewId: string;
  anchor: HoverAnchor;
  /** Pinned = the user is actively editing; stays open until dismissed. */
  pinned: boolean;
  onChanged: () => void;
  onDelete: () => void;
  /** Promote a hover to an editing session. */
  onRequestPin: () => void;
  /** Dismiss a pinned card (Esc / outside click). */
  onClose: () => void;
  /** Open the assistant thread for an "ask_ai" highlight. */
  onOpenThread: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const CARD_WIDTH = 264;
const GAP = 10;
const PAD = 8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

type Placement = "right" | "left" | "above" | "below";

export default function NoteHoverCard({
  annotation,
  reviewId,
  anchor,
  pinned,
  onChanged,
  onDelete,
  onRequestPin,
  onClose,
  onOpenThread,
  onPointerEnter,
  onPointerLeave,
}: NoteHoverCardProps) {
  const isAskAi = annotation.kind === "ask_ai";
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Measure the card so placement can account for its real size. An observer
  // re-measures when content changes (hover preview ↔ editing textarea).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // ── Local note state with the same debounced autosave the rail card uses.
  // The parent remounts this card (keyed by id) when the annotation changes,
  // so the initializer is enough — no syncing effect needed. ───────────────
  const [note, setNote] = useState(annotation.note);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    (value: string, immediate = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const run = () => {
        void updateAnnotation(reviewId, annotation.id, { note: value }).then(
          () => onChanged(),
        );
      };
      if (immediate) run();
      else saveTimer.current = setTimeout(run, 400);
    },
    [reviewId, annotation.id, onChanged],
  );

  // Measure via a ResizeObserver so re-measuring on content change happens in
  // a subscription callback rather than an effect derived from reactive state.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Placement: a simple popover anchored to the highlight, kept inside the
  //    reading column. Opens below the line; flips above only when there's no
  //    room below. Horizontally aligned to the highlight, clamped to the
  //    column edges so it never drifts out into the margin. ─────────────────
  const pos = useMemo<{
    top: number;
    left: number;
    placement: Placement;
  } | null>(() => {
    if (!size) return null;
    const { w, h } = size;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Stay within the reading column (and the viewport as a backstop).
    const minLeft = Math.max(PAD, anchor.colLeft);
    const maxLeft = Math.min(vw - w - PAD, anchor.colRight - w);
    const left = clamp(anchor.left, minLeft, Math.max(minLeft, maxLeft));

    const fitsBelow = anchor.bottom + GAP + h <= vh - PAD;
    const fitsAbove = anchor.top - GAP - h >= PAD;
    if (!fitsBelow && fitsAbove) {
      return { placement: "above", left, top: anchor.top - GAP - h };
    }
    return { placement: "below", left, top: anchor.bottom + GAP };
  }, [anchor, size]);

  // Focus the textarea when a comment card becomes pinned.
  useEffect(() => {
    if (pinned && !isAskAi) {
      const t = setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }, 20);
      return () => clearTimeout(t);
    }
  }, [pinned, isAskAi]);

  // Esc + outside-click dismiss while pinned (flushing any pending save).
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        save(note, true);
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        save(note, true);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Defer so the click that pinned the card doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [pinned, note, save, onClose]);

  const ready = pos !== null;

  return (
    <div
      ref={ref}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      className="fixed z-50"
      style={{
        top: ready ? pos!.top : -9999,
        left: ready ? pos!.left : -9999,
        width: CARD_WIDTH,
      }}
    >
      <div
        className={[
          "overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-lg)]",
          "transition-[opacity,transform] duration-150 ease-[var(--ease-out)]",
          ready
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-1 pointer-events-none",
        ].join(" ")}
      >
        {isAskAi ? (
          <div className="px-3.5 py-3">
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-tight"
              style={{
                background: "var(--badge-accent-bg)",
                color: "var(--badge-accent-fg)",
              }}
            >
              <Sparkles className="size-3" strokeWidth={2} />
              Dive deeper
            </span>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {annotation.thread.length === 0
                ? "No replies yet."
                : `${annotation.thread.length} ${
                    annotation.thread.length === 1 ? "message" : "messages"
                  } in this thread.`}
            </p>
            <button
              type="button"
              onClick={onOpenThread}
              className="mt-2 text-[12px] font-medium text-primary transition-opacity hover:opacity-80"
            >
              Open in assistant &rarr;
            </button>
          </div>
        ) : pinned ? (
          <div className="flex flex-col">
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                save(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save(note, true);
                  onClose();
                }
              }}
              rows={3}
              placeholder="Write a note…  (Shift+Enter for newline)"
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
              <span className="text-[11px] text-muted-foreground">
                Enter to save
              </span>
              <button
                type="button"
                onClick={() => {
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  onDelete();
                }}
                className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-destructive"
                title="Delete note"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRequestPin}
            className="block w-full px-3.5 py-3 text-left transition-colors hover:bg-muted/40"
          >
            {annotation.note ? (
              <p className="text-[13px] leading-relaxed text-foreground">
                {annotation.note}
              </p>
            ) : (
              <p className="text-[13px] italic leading-relaxed text-muted-foreground/70">
                Add a note…
              </p>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
