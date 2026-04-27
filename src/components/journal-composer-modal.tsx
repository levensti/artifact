"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import type { Model } from "@/lib/models";
import { resolveModelCredentials } from "@/lib/keys";
import {
  loadWikiPages,
  saveWikiPage,
  updateWikiPage,
} from "@/lib/client-data";
import {
  beginWikiIngest,
  endWikiIngest,
  reportWikiIngestError,
} from "@/lib/wiki-status";
import {
  buildSessionSlug,
  composeJournalEntryFromPrompt,
  uniquifySlug,
} from "@/lib/journal-entry-builder";
import { Button } from "@/components/ui/button";

interface JournalComposerModalProps {
  selectedModel: Model | null;
  onClose: () => void;
  onCreated?: (slug: string) => void;
}

export default function JournalComposerModal({
  selectedModel,
  onClose,
  onCreated,
}: JournalComposerModalProps) {
  const [prompt, setPrompt] = useState("");
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleDraft = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!selectedModel) {
      setValidationErr("Choose a model first.");
      return;
    }
    const creds = resolveModelCredentials(selectedModel);
    if (!creds) {
      setValidationErr("API key for this model is not configured.");
      return;
    }
    setValidationErr(null);
    setSubmitting(true);

    // Create the entry first so the user can navigate to it and watch
    // tokens stream in. Title is the user's prompt (clipped) — they can
    // rename anytime via the entry editor.
    let slug: string;
    try {
      const existing = await loadWikiPages();
      const slugs = new Set(existing.map((p) => p.slug));
      const initialTitle = trimmed.slice(0, 80);
      slug = uniquifySlug(buildSessionSlug(initialTitle), slugs);
      await saveWikiPage({
        slug,
        title: initialTitle,
        content: "",
        pageType: "session",
      });
    } catch (err) {
      setSubmitting(false);
      setValidationErr(
        err instanceof Error ? err.message : "Failed to create entry.",
      );
      return;
    }

    onCreated?.(slug);
    onClose();

    // Stream into the entry in the background.
    void streamIntoEntry({
      slug,
      prompt: trimmed,
      model: selectedModel,
      apiKey: creds.apiKey,
      apiBaseUrl: creds.apiBaseUrl,
    });
  }, [onClose, onCreated, prompt, selectedModel]);

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
            <Sparkles className="size-4 text-primary/70" strokeWidth={1.8} />
            <span className="text-[13px] font-semibold text-foreground">
              New journal entry
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

        <div className="flex flex-col gap-3 p-5">
          <label className="text-[12px] font-medium text-foreground/80">
            What do you want to record?
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. what I've been learning about diffusion samplers this week"
            disabled={submitting}
            className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/15 disabled:opacity-60"
          />
          <p className="text-[11px] text-muted-foreground/60">
            Drafted from your reviews, chats, and annotations from the last 30
            days. The entry appears in your journal immediately and fills in as
            tokens stream.
          </p>
          {validationErr ? (
            <p className="text-[12px] text-destructive">{validationErr}</p>
          ) : null}
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
            onClick={handleDraft}
            disabled={!prompt.trim() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                Creating…
              </>
            ) : (
              "Draft"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface StreamArgs {
  slug: string;
  prompt: string;
  model: Model;
  apiKey: string;
  apiBaseUrl: string | undefined;
}

async function streamIntoEntry(opts: StreamArgs): Promise<void> {
  const token = beginWikiIngest({
    kind: "journal",
    label: "Drafting journal entry",
  });
  let lastPersistedAt = 0;
  let pending: string | null = null;

  const persist = async (content: string): Promise<void> => {
    try {
      await updateWikiPage(opts.slug, { content });
    } catch {
      /* ignore — final flush will retry */
    }
  };

  try {
    const final = await composeJournalEntryFromPrompt({
      prompt: opts.prompt,
      model: opts.model,
      apiKey: opts.apiKey,
      apiBaseUrl: opts.apiBaseUrl,
      onText: (acc) => {
        const now = Date.now();
        if (now - lastPersistedAt >= 200) {
          lastPersistedAt = now;
          pending = null;
          void persist(acc);
        } else {
          pending = acc;
        }
      },
    });
    // Final flush — make sure the last debounced chunk lands.
    if (pending !== null) await persist(pending);
    await persist(final.trim() + "\n");
    reportWikiIngestError(null);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to draft entry.";
    reportWikiIngestError(message);
  } finally {
    endWikiIngest(token);
  }
}
