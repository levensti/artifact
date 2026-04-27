"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import type { Model } from "@/lib/models";
import { resolveModelCredentials } from "@/lib/keys";
import type { Annotation } from "@/lib/annotations";
import { loadMessages } from "@/lib/reviews";
import {
  loadWikiPage,
  loadWikiPages,
  saveWikiPage,
  updateWikiPage,
} from "@/lib/client-data";
import {
  beginWikiIngest,
  endWikiIngest,
  reportWikiIngestError,
} from "@/lib/wiki-status";
import type { WikiPage } from "@/lib/wiki";
import {
  buildSessionSlug,
  summarizeChatToJournal,
  summarizeChatToJournalAddendum,
  uniquifySlug,
} from "@/lib/journal-entry-builder";
import { Button } from "@/components/ui/button";

interface JournalCheckpointModalProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  annotations: Annotation[];
  selectedModel: Model | null;
  onClose: () => void;
}

type Mode = "new" | "append";

export default function JournalCheckpointModal({
  reviewId,
  arxivId,
  paperTitle,
  annotations,
  selectedModel,
  onClose,
}: JournalCheckpointModalProps) {
  const [angle, setAngle] = useState("");
  const [mode, setMode] = useState<Mode>("new");
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [targetSlug, setTargetSlug] = useState<string>("");
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWikiPages().then((list) => {
      if (cancelled) return;
      const journalPages = list
        .filter((p) => p.pageType === "session" || p.pageType === "digest")
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      setPages(journalPages);
      if (journalPages.length > 0) setTargetSlug(journalPages[0].slug);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const hasExisting = pages.length > 0;

  const handleSave = useCallback(async () => {
    if (!selectedModel) {
      setValidationErr("Choose a model first.");
      return;
    }
    const creds = resolveModelCredentials(selectedModel);
    if (!creds) {
      setValidationErr("API key for this model is not configured.");
      return;
    }
    if (mode === "append" && !targetSlug) {
      setValidationErr("Pick an entry to append to.");
      return;
    }
    setValidationErr(null);
    setSubmitting(true);

    const angleSnapshot = angle.trim() || undefined;
    const modeSnapshot = mode;
    const targetSlugSnapshot = targetSlug;
    const model = selectedModel;
    const apiKey = creds.apiKey;
    const apiBaseUrl = creds.apiBaseUrl;

    try {
      const messages = await loadMessages(reviewId);
      const annotationThreads = annotations
        .filter((a) => a.kind === "ask_ai" && a.thread.length > 0)
        .map((a) => ({
          highlightText: a.highlightText,
          messages: a.thread,
        }));
      if (messages.length === 0 && annotationThreads.length === 0) {
        setSubmitting(false);
        setValidationErr("No chat or selection threads to summarize yet.");
        return;
      }

      // For "new" we create the destination page now so the user can
      // navigate to it and watch tokens stream in. For "append" we patch
      // the existing page with a date-stamped header that streaming fills
      // beneath.
      let slug: string;
      let appendPrefix: string | null = null;
      let existingTitle = "";
      let existingMarkdown = "";
      if (modeSnapshot === "new") {
        const existing = await loadWikiPages();
        const slugs = new Set(existing.map((p) => p.slug));
        const initialTitle = `${paperTitle} — ${formatDateLabel(new Date())}`;
        slug = uniquifySlug(buildSessionSlug(initialTitle), slugs);
        await saveWikiPage({
          slug,
          title: initialTitle.slice(0, 200),
          content: "",
          pageType: "session",
          reviewId,
        });
      } else {
        const target = await loadWikiPage(targetSlugSnapshot);
        if (!target) {
          setSubmitting(false);
          setValidationErr(
            `Target entry ${targetSlugSnapshot} no longer exists.`,
          );
          return;
        }
        slug = target.slug;
        existingTitle = target.title;
        existingMarkdown = target.content.trimEnd();
        appendPrefix = `${existingMarkdown}\n\n## Update — ${formatDateLabel(
          new Date(),
        )}\n\n`;
        await updateWikiPage(slug, { content: appendPrefix });
      }

      onClose();

      // Background streaming.
      void streamIntoEntry({
        mode: modeSnapshot,
        slug,
        appendPrefix,
        existingTitle,
        existingMarkdown,
        reviewId,
        arxivId,
        paperTitle,
        messages,
        annotationThreads,
        angle: angleSnapshot,
        model,
        apiKey,
        apiBaseUrl,
      });
    } catch (err) {
      setSubmitting(false);
      setValidationErr(
        err instanceof Error ? err.message : "Failed to start save.",
      );
    }
  }, [
    angle,
    annotations,
    arxivId,
    mode,
    onClose,
    paperTitle,
    reviewId,
    selectedModel,
    targetSlug,
  ]);

  const targetTitle = useMemo(
    () => pages.find((p) => p.slug === targetSlug)?.title,
    [pages, targetSlug],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-8 animate-in fade-in duration-150"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="size-4 text-primary/70" strokeWidth={1.8} />
            <span className="text-[13px] font-semibold text-foreground">
              Save chat to journal
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-foreground/80">
              Angle <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              rows={2}
              placeholder="e.g. focus on the implications for distributed training"
              disabled={submitting}
              className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/15 disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-foreground/80">
              Where to save
            </span>
            <label className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 cursor-pointer hover:border-border">
              <input
                type="radio"
                name="checkpoint-mode"
                value="new"
                checked={mode === "new"}
                onChange={() => setMode("new")}
                disabled={submitting}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="text-[12.5px] font-medium text-foreground">
                  Create a new entry
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  A fresh journal page summarizing this chat.
                </span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 rounded-md border bg-card px-3 py-2 ${
                hasExisting && !submitting
                  ? "border-border/60 cursor-pointer hover:border-border"
                  : "border-border/40 opacity-60 cursor-not-allowed"
              }`}
            >
              <input
                type="radio"
                name="checkpoint-mode"
                value="append"
                checked={mode === "append"}
                onChange={() => setMode("append")}
                disabled={!hasExisting || submitting}
                className="mt-0.5"
              />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-foreground">
                  Add to an existing entry
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {hasExisting
                    ? "Fold new learnings into a page you've already written."
                    : "No existing entries yet."}
                </span>
                {mode === "append" && hasExisting ? (
                  <select
                    value={targetSlug}
                    onChange={(e) => setTargetSlug(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={submitting}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/15 disabled:opacity-60"
                  >
                    {pages.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
          </div>

          {validationErr ? (
            <p className="text-[12px] text-destructive">{validationErr}</p>
          ) : null}

          <p className="text-[11px] text-muted-foreground/60">
            The entry appears in your journal immediately and fills in as
            tokens stream — you can keep working in the meantime.
          </p>
        </div>

        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-border/60 px-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={submitting}
          >
            {mode === "append" && targetTitle
              ? `Add to "${truncate(targetTitle, 22)}"`
              : "Create entry"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface StreamIntoEntryArgs {
  mode: Mode;
  slug: string;
  /** For append mode: the existing body + date header that streamed tokens land beneath. Null for new. */
  appendPrefix: string | null;
  /** For append mode: original entry title (sent to model as context). */
  existingTitle: string;
  /** For append mode: original body (sent to model as context, NOT the appendPrefix). */
  existingMarkdown: string;
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  messages: Awaited<ReturnType<typeof loadMessages>>;
  annotationThreads: {
    highlightText: string;
    messages: Annotation["thread"];
  }[];
  angle: string | undefined;
  model: Model;
  apiKey: string;
  apiBaseUrl: string | undefined;
}

async function streamIntoEntry(opts: StreamIntoEntryArgs): Promise<void> {
  const label =
    opts.mode === "append" ? "Updating journal entry" : "Drafting journal entry";
  const token = beginWikiIngest({ kind: "journal", label });

  let lastPersistedAt = 0;
  let pending: string | null = null;

  const persist = async (body: string): Promise<void> => {
    const full =
      opts.mode === "append" && opts.appendPrefix
        ? opts.appendPrefix + body
        : body;
    try {
      await updateWikiPage(opts.slug, { content: full });
    } catch {
      /* ignore — final flush will retry */
    }
  };

  try {
    const onText = (acc: string) => {
      const now = Date.now();
      if (now - lastPersistedAt >= 200) {
        lastPersistedAt = now;
        pending = null;
        void persist(acc);
      } else {
        pending = acc;
      }
    };

    let final: string;
    if (opts.mode === "new") {
      final = await summarizeChatToJournal({
        reviewId: opts.reviewId,
        arxivId: opts.arxivId,
        paperTitle: opts.paperTitle,
        messages: opts.messages,
        annotationThreads: opts.annotationThreads,
        angle: opts.angle,
        model: opts.model,
        apiKey: opts.apiKey,
        apiBaseUrl: opts.apiBaseUrl,
        onText,
      });
    } else {
      final = await summarizeChatToJournalAddendum({
        reviewId: opts.reviewId,
        arxivId: opts.arxivId,
        paperTitle: opts.paperTitle,
        messages: opts.messages,
        annotationThreads: opts.annotationThreads,
        angle: opts.angle,
        existingTitle: opts.existingTitle,
        existingMarkdown: opts.existingMarkdown,
        model: opts.model,
        apiKey: opts.apiKey,
        apiBaseUrl: opts.apiBaseUrl,
        onText,
      });
    }

    if (pending !== null) await persist(pending);
    await persist(final.trim() + "\n");
    reportWikiIngestError(null);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save chat to journal.";
    reportWikiIngestError(message);
  } finally {
    endWikiIngest(token);
  }
}
