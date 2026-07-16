"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Podcast,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import GeneratePodcastDialog from "@/components/generate-podcast-dialog";
import { hasPodcastTts } from "@/lib/keys";
import {
  createPodcast,
  deletePodcast,
  getPodcast,
  listPodcasts,
} from "@/lib/client/podcasts";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";
import type { PodcastDTO } from "@/lib/podcast";

interface MediaPanelProps {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
}

/** How often to re-poll a generating episode. */
const POLL_INTERVAL_MS = 3_000;

function formatDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The Media tab: generate and listen to single-host podcast episodes for the
 * paper. Episodes persist, so a generating one keeps ticking across refreshes
 * (this panel polls it) and finished ones load instantly.
 */
export default function MediaPanel({
  reviewId,
  paperTitle,
  paperContext,
}: MediaPanelProps) {
  const [podcasts, setPodcasts] = useState<PodcastDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ttsAvailable = hasPodcastTts();

  // Load the review's episodes on mount. The panel is keyed by reviewId in the
  // parent, so switching reviews remounts it and this runs afresh — no
  // synchronous in-effect reset needed.
  useEffect(() => {
    let cancelled = false;
    listPodcasts(reviewId)
      .then((rows) => {
        if (!cancelled) {
          setPodcasts(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  // Poll while any episode is still generating; stop once all settle.
  const generating = podcasts.some((p) => p.status === "generating");
  useEffect(() => {
    if (!generating) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const pending = podcasts.filter((p) => p.status === "generating");
      const updates = await Promise.all(
        pending.map((p) => getPodcast(p.id).catch(() => null)),
      );
      if (cancelled) return;
      setPodcasts((prev) =>
        prev.map((p) => updates.find((u) => u && u.id === p.id) ?? p),
      );
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [generating, podcasts]);

  const handleConfirm = useCallback(
    async (instructions: string) => {
      setDialogOpen(false);
      setError(null);
      try {
        const podcast = await createPodcast({
          reviewId,
          paperTitle,
          paperContext,
          instructions: instructions || undefined,
        });
        setPodcasts((prev) => [podcast, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start generation.");
      }
    },
    [reviewId, paperTitle, paperContext],
  );

  const handleDelete = useCallback(async (id: string) => {
    setPodcasts((prev) => prev.filter((p) => p.id !== id));
    await deletePodcast(id).catch(() => {
      /* best-effort; the row is already gone from the UI */
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!ttsAvailable ? (
          <EmptyNote>
            Podcast generation isn&apos;t configured on this server. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              PODCAST_TTS_MODEL
            </code>{" "}
            to enable it.
          </EmptyNote>
        ) : !loaded ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={2} />
          </div>
        ) : podcasts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <Podcast className="size-7 text-muted-foreground" strokeWidth={1.6} />
            <p
              className="text-[13px] leading-[1.55] text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              Turn this paper into a short podcast episode you can listen to on
              the go.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {podcasts.map((p) => (
              <EpisodeCard key={p.id} podcast={p} onDelete={handleDelete} />
            ))}
          </ul>
        )}

        {error ? (
          <p className="mt-3 text-[12px]" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        ) : null}
      </div>

      {ttsAvailable ? (
        <div className="shrink-0 border-t border-border bg-background p-3">
          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="w-full gap-1.5 text-[13px] font-medium"
          >
            <Podcast className="size-3.5" strokeWidth={2} />
            {podcasts.length === 0 ? "Generate podcast" : "New episode"}
          </Button>
        </div>
      ) : null}

      <GeneratePodcastDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function EpisodeCard({
  podcast,
  onDelete,
}: {
  podcast: PodcastDTO;
  onDelete: (id: string) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const duration = formatDuration(podcast.durationSec);

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {podcast.title || "Podcast episode"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{formatRelative(podcast.createdAt)}</span>
            {duration ? <span>· {duration}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDelete(podcast.id)}
          title="Delete episode"
          aria-label="Delete episode"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-muted"
        >
          <Trash2 className="size-[14px]" strokeWidth={2} aria-hidden />
        </button>
      </div>

      {podcast.instructions ? (
        <div className="mt-1.5 text-[11.5px] italic text-muted-foreground">
          “{podcast.instructions}”
        </div>
      ) : null}

      {podcast.status === "generating" ? (
        <div className="mt-2.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          Writing script and recording audio…
        </div>
      ) : podcast.status === "failed" ? (
        <div className="mt-2.5 flex items-start gap-2 text-[12px]" style={{ color: "var(--destructive)" }}>
          <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          <span>{podcast.error || "Generation failed."}</span>
        </div>
      ) : (
        <div className="mt-2.5">
          {podcast.audioUrl ? (
            <audio
              controls
              preload="none"
              src={podcast.audioUrl}
              className="w-full"
            />
          ) : null}
          {podcast.transcript ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    showTranscript ? "rotate-180" : "",
                  )}
                  strokeWidth={2}
                  aria-hidden
                />
                Transcript
              </button>
              {showTranscript ? (
                <div
                  className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.6] text-foreground/90"
                  style={{ fontFamily: "var(--font-reading)" }}
                >
                  {podcast.transcript}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <Podcast className="size-7 text-muted-foreground" strokeWidth={1.6} />
      <p
        className="text-[13px] leading-[1.55] text-muted-foreground"
        style={{ fontFamily: "var(--font-reading)" }}
      >
        {children}
      </p>
    </div>
  );
}
