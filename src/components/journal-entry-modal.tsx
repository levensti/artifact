"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  BookMarked,
  Check,
  ChevronLeft,
  Loader2,
  Pencil,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { updateWikiPage } from "@/lib/client-data";
import { exportWikiToFile } from "@/lib/client/sharing/export-wiki";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";
import MarkdownMessage from "./markdown-message";
import WikiEditor from "./wiki-editor";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface JournalEntryModalProps {
  page: WikiPage;
  onClose: () => void;
}

export default function JournalEntryModal({
  page,
  onClose,
}: JournalEntryModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(page.title);
  const [draftContent, setDraftContent] = useState(page.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [shareStatus, setShareStatus] = useState<
    "idle" | "sharing" | "error"
  >("idle");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [prevSlug, setPrevSlug] = useState(page.slug);
  if (prevSlug !== page.slug) {
    setPrevSlug(page.slug);
    setIsEditing(false);
    setSaveStatus("idle");
    setDraftTitle(page.title);
    setDraftContent(page.content);
  } else if (!isEditing) {
    if (draftTitle !== page.title) setDraftTitle(page.title);
    if (draftContent !== page.content) setDraftContent(page.content);
  }

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draftTitle, isEditing]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditing) {
          void flushAndExit();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, isEditing]);

  const scheduleSave = useCallback(
    (nextTitle: string, nextContent: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          await updateWikiPage(page.slug, {
            title: nextTitle,
            content: nextContent,
          });
          setSaveStatus("saved");
        } catch {
          setSaveStatus("error");
        }
      }, 800);
    },
    [page.slug],
  );

  const flushAndExit = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (draftTitle !== page.title || draftContent !== page.content) {
      setSaveStatus("saving");
      try {
        await updateWikiPage(page.slug, {
          title: draftTitle,
          content: draftContent,
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
        return;
      }
    }
    setIsEditing(false);
  };

  const [clickCoords, setClickCoords] = useState<{ x: number; y: number } | null>(null);

  const startEditing = (e?: React.MouseEvent) => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    if (e) {
      setClickCoords({ x: e.clientX, y: e.clientY });
    }
    setIsEditing(true);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
    });
  };

  const handleContentChange = useCallback(
    (md: string) => {
      setDraftContent(md);
      scheduleSave(draftTitle, md);
    },
    [draftTitle, scheduleSave],
  );

  const isDigest = page.pageType === "digest";
  const updatedLabel = formatRelative(page.updatedAt);

  const handleShare = async () => {
    setShareStatus("sharing");
    try {
      await exportWikiToFile(page.slug, { depth: 1 });
      setShareStatus("idle");
    } catch {
      setShareStatus("error");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-150" style={{ background: 'var(--reader-mat)' }}>
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-3 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--reader-mat) 80%, transparent)' }}>
        <button
          type="button"
          onClick={() => {
            if (isEditing) void flushAndExit();
            onClose();
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Journal</span>
        </button>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          {isDigest ? (
            <Sparkles className="size-3 text-primary/50" strokeWidth={1.8} />
          ) : (
            <BookMarked className="size-3 text-primary/50" strokeWidth={1.8} />
          )}
          <span>{isDigest ? "Weekly digest" : "Study session"}</span>
          <span className="hidden sm:inline">· Updated {updatedLabel}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <SaveIndicator status={saveStatus} />

          <button
            type="button"
            onClick={handleShare}
            disabled={shareStatus === "sharing"}
            title="Export as shareable file"
            aria-label="Share entry"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {shareStatus === "sharing" ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={2} />
            ) : (
              <Share2 className="size-3" strokeWidth={1.75} />
            )}
            <span className="hidden sm:inline">Share</span>
          </button>

          {isEditing ? (
            <button
              type="button"
              onClick={() => void flushAndExit()}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Check className="size-3" strokeWidth={2} />
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3" strokeWidth={1.75} />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (isEditing) void flushAndExit();
              onClose();
            }}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Scrollable page body */}
      <div ref={scrollRef} className="h-[calc(100vh-2.75rem)] overflow-y-auto">
        <article className="mx-auto w-full max-w-[680px] rounded-xl bg-card px-8 pb-32 pt-12 shadow-sm border border-border/40 sm:px-6 mt-8 mb-16">
          {/* Title */}
          {isEditing ? (
            <textarea
              ref={titleRef}
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value);
                scheduleSave(e.target.value, draftContent);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              rows={1}
              placeholder="Untitled"
              className="wiki-title-input w-full"
              spellCheck
            />
          ) : (
            <h1
              className="wiki-title cursor-text"
              onClick={(e) => startEditing(e)}
            >
              {page.title}
            </h1>
          )}

          {/* Metadata */}
          <div className="mt-4 mb-8 flex items-center gap-3 text-[11.5px] text-muted-foreground/45">
            <span>{isDigest ? "Weekly digest" : "Study session"}</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span>Updated {updatedLabel}</span>
          </div>

          {/* Body — Tiptap when editing, rendered markdown when reading */}
          {isEditing ? (
            <WikiEditor
              content={draftContent}
              onChange={handleContentChange}
              placeholder="Start writing..."
              autoFocus
              focusCoords={clickCoords}
            />
          ) : (
            <div
              className="prose-wiki cursor-text"
              onClick={(e) => startEditing(e)}
            >
              <MarkdownMessage content={page.content} />
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] transition-opacity",
        status === "saving" && "text-muted-foreground/60",
        status === "saved" && "text-success/70",
        status === "error" && "text-destructive/70",
      )}
    >
      {status === "saving" && (
        <Loader2 className="size-2.5 animate-spin" strokeWidth={2} />
      )}
      {status === "saved" && <Check className="size-2.5" strokeWidth={2.5} />}
      {status === "saving"
        ? "Saving..."
        : status === "saved"
          ? "Saved"
          : "Save failed"}
    </span>
  );
}
