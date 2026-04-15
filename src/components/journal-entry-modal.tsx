"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BookMarked, Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { updateWikiPage } from "@/lib/client-data";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";
import MarkdownMessage from "./markdown-message";

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
  const [editTab, setEditTab] = useState<"write" | "preview">("write");
  const [draftTitle, setDraftTitle] = useState(page.title);
  const [draftContent, setDraftContent] = useState(page.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTextareaRef = useRef<HTMLTextAreaElement>(null);

  // If the caller swaps to a different page (rare, but possible via
  // deep-link changes), reset local state.
  const [prevSlug, setPrevSlug] = useState(page.slug);
  if (prevSlug !== page.slug) {
    setPrevSlug(page.slug);
    setIsEditing(false);
    setEditTab("write");
    setSaveStatus("idle");
    setDraftTitle(page.title);
    setDraftContent(page.content);
  } else if (!isEditing) {
    if (draftTitle !== page.title) setDraftTitle(page.title);
    if (draftContent !== page.content) setDraftContent(page.content);
  }

  useLayoutEffect(() => {
    const el = titleTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draftTitle, isEditing]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Close on Escape so the modal feels native.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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

  const isDigest = page.pageType === "digest";
  const updatedLabel = formatRelative(page.updatedAt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[780px] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/8">
              {isDigest ? (
                <Sparkles className="size-[14px] text-primary/60" strokeWidth={1.8} />
              ) : (
                <BookMarked className="size-[14px] text-primary/60" strokeWidth={1.8} />
              )}
            </div>
            <span className="text-[11px] font-medium text-muted-foreground/80">
              {isDigest ? "Weekly digest" : "Study session"}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              · Updated {updatedLabel}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {isEditing ? <SaveIndicator status={saveStatus} /> : null}
              {isEditing ? (
                <button
                  type="button"
                  onClick={flushAndExit}
                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  <Check className="size-3" strokeWidth={2} />
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  <Pencil className="size-3" strokeWidth={2} />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex size-6 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>

          {isEditing ? (
            <textarea
              ref={titleTextareaRef}
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value);
                scheduleSave(e.target.value, draftContent);
              }}
              rows={1}
              placeholder="Untitled"
              className="wiki-title-input mt-3"
              spellCheck
            />
          ) : (
            <h1 className="wiki-title mt-3">{page.title}</h1>
          )}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isEditing ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-0.5 self-start rounded-lg border border-border/60 bg-card p-0.5 shadow-sm">
                {(["write", "preview"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEditTab(mode)}
                    className={cn(
                      "rounded-md px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                      editTab === mode
                        ? "bg-primary/8 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {editTab === "write" ? (
                <textarea
                  value={draftContent}
                  onChange={(e) => {
                    setDraftContent(e.target.value);
                    scheduleSave(draftTitle, e.target.value);
                  }}
                  placeholder="Start writing in Markdown…"
                  className="wiki-body-textarea min-h-[300px]"
                  spellCheck
                />
              ) : (
                <div className="prose-wiki">
                  <MarkdownMessage content={draftContent || "_(empty)_"} />
                </div>
              )}
            </div>
          ) : (
            <div className="prose-wiki">
              <MarkdownMessage content={page.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" strokeWidth={2} />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
        <Check className="size-3" strokeWidth={2.5} />
        Saved
      </span>
    );
  }
  return (
    <span className="text-[10px] text-rose-600">Save failed — retry</span>
  );
}
