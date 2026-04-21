"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  commitReviewBundle,
  commitWikiBundle,
  previewBundleFromText,
  type BundlePreview,
  type ReviewCollisionStrategy,
  type WikiCollisionStrategy,
} from "@/lib/client/sharing/import-bundle";

type ImportMode = "review" | "journal";

type ReviewPreview = Extract<BundlePreview, { kind: "review" }>;
type WikiPreview = Extract<BundlePreview, { kind: "wiki" }>;

type Stage =
  | { kind: "pick" }
  | { kind: "loading" }
  | { kind: "preview"; preview: BundlePreview }
  | { kind: "error"; message: string }
  | { kind: "committing" }
  | { kind: "done"; message: string };

interface ImportBundleDialogProps {
  open: boolean;
  mode: ImportMode;
  onClose: () => void;
}

const MODE_COPY: Record<
  ImportMode,
  {
    title: string;
    description: string;
    fileHint: string;
    wrongKindError: string;
  }
> = {
  review: {
    title: "Import a shared review",
    description: "Open a review bundle someone shared with you.",
    fileHint: "review-*.json",
    wrongKindError:
      "This looks like a journal entry. Use “import a shared entry” under Journal instead.",
  },
  journal: {
    title: "Import a shared journal entry",
    description: "Open a journal bundle someone shared with you.",
    fileHint: "journal-*.json",
    wrongKindError:
      "This looks like a review. Use “import a shared review” under Start a review instead.",
  },
};

export default function ImportBundleDialog({
  open,
  mode,
  onClose,
}: ImportBundleDialogProps) {
  const copy = MODE_COPY[mode];
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [reviewStrategy, setReviewStrategy] =
    useState<ReviewCollisionStrategy>("copy");
  const [wikiStrategy, setWikiStrategy] =
    useState<WikiCollisionStrategy>("skip");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const reset = useCallback(() => {
    setStage({ kind: "pick" });
    setReviewStrategy("copy");
    setWikiStrategy("skip");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const expectedKind = mode === "review" ? "review" : "wiki";

  const handleFile = useCallback(
    async (file: File) => {
      setStage({ kind: "loading" });
      try {
        const text = await file.text();
        const parsed = await previewBundleFromText(text);
        if (!parsed.ok || !parsed.preview) {
          setStage({
            kind: "error",
            message: parsed.error ?? "Unknown error parsing bundle.",
          });
          return;
        }
        if (parsed.preview.kind !== expectedKind) {
          setStage({ kind: "error", message: copy.wrongKindError });
          return;
        }
        setStage({ kind: "preview", preview: parsed.preview });
      } catch (err) {
        setStage({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to read file contents.",
        });
      }
    },
    [expectedKind, copy.wrongKindError],
  );

  const handleCommit = useCallback(async () => {
    if (stage.kind !== "preview") return;
    setStage({ kind: "committing" });
    try {
      if (stage.preview.kind === "review") {
        const result = await commitReviewBundle(
          stage.preview.bundle,
          reviewStrategy,
        );
        if (result.skipped) {
          setStage({
            kind: "done",
            message:
              "Skipped — a review with this source is already in your library.",
          });
          return;
        }
        setStage({
          kind: "done",
          message: "Review imported. Opening it now…",
        });
        setTimeout(() => {
          router.push(`/review/${result.finalReviewId}`);
          handleClose();
        }, 700);
      } else {
        const result = await commitWikiBundle(
          stage.preview.bundle,
          wikiStrategy,
        );
        const parts: string[] = [];
        if (result.imported > 0) parts.push(`${result.imported} imported`);
        if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
        if (result.renamed > 0) parts.push(`${result.renamed} renamed`);
        setStage({
          kind: "done",
          message: parts.length > 0 ? parts.join(", ") : "Nothing to import.",
        });
      }
    } catch (err) {
      setStage({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to write bundle.",
      });
    }
  }, [stage, reviewStrategy, wikiStrategy, router, handleClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {stage.kind === "pick" && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <Upload
                className="size-5 text-muted-foreground"
                strokeWidth={1.75}
              />
              <span className="text-[13px] font-medium text-foreground">
                Choose a bundle file
              </span>
              <span className="text-[11px] text-muted-foreground">
                {copy.fileHint}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>
        )}

        {stage.kind === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-[12px]">Parsing bundle…</span>
          </div>
        )}

        {stage.kind === "preview" && stage.preview.kind === "review" && (
          <ReviewPreviewBody
            preview={stage.preview}
            strategy={reviewStrategy}
            onStrategyChange={setReviewStrategy}
          />
        )}

        {stage.kind === "preview" && stage.preview.kind === "wiki" && (
          <WikiPreviewBody
            preview={stage.preview}
            strategy={wikiStrategy}
            onStrategyChange={setWikiStrategy}
          />
        )}

        {stage.kind === "committing" && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-[12px]">Writing to your library…</span>
          </div>
        )}

        {stage.kind === "done" && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <FileDown className="size-5 text-success" strokeWidth={1.75} />
            <p className="text-[13px] text-foreground">{stage.message}</p>
          </div>
        )}

        {stage.kind === "error" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
            <p className="font-medium">Could not import this file.</p>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug opacity-90">
              {stage.message}
            </pre>
          </div>
        )}

        <DialogFooter>
          {stage.kind === "preview" ? (
            <>
              <Button variant="outline" size="sm" onClick={reset}>
                Back
              </Button>
              <Button size="sm" onClick={handleCommit}>
                Import
              </Button>
            </>
          ) : stage.kind === "error" ? (
            <>
              <Button variant="outline" size="sm" onClick={reset}>
                Try again
              </Button>
              <Button size="sm" onClick={handleClose}>
                Close
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleClose}>
              {stage.kind === "done" ? "Close" : "Cancel"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReviewPreviewBodyProps {
  preview: ReviewPreview;
  strategy: ReviewCollisionStrategy;
  onStrategyChange: (next: ReviewCollisionStrategy) => void;
}

function ReviewPreviewBody({
  preview,
  strategy,
  onStrategyChange,
}: ReviewPreviewBodyProps) {
  const { bundle, counts, idExists, duplicateOfExistingId, notes } = preview;
  const review = bundle.data.review;
  const hasCollision = idExists || duplicateOfExistingId !== null;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border/70 bg-card/50 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
          Review
        </p>
        <p
          className="mt-0.5 truncate text-[13px] font-medium text-foreground"
          title={review.title}
        >
          {review.title}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {review.arxivId
            ? `arXiv:${review.arxivId}`
            : review.sourceUrl
            ? review.sourceUrl
            : "Unknown source"}
        </p>
      </div>

      {(() => {
        const items: Array<{ n: number; label: string }> = [
          { n: counts.messages, label: "chat messages" },
          { n: counts.annotations, label: "annotations" },
          { n: counts.deepDives, label: "deep dives" },
          { n: counts.graphNodes, label: "related works" },
        ].filter((item) => item.n > 0);

        if (items.length === 0) {
          return (
            <p className="text-[11px] text-muted-foreground">
              This bundle has no chat history or annotations yet — just the
              paper itself.
            </p>
          );
        }

        return (
          <ul className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            {items.map(({ n, label }) => (
              <li key={label}>
                <span className="font-semibold tabular-nums text-foreground">
                  {n}
                </span>{" "}
                {label}
              </li>
            ))}
          </ul>
        );
      })()}

      {hasCollision ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            You already have this review in your library
          </p>
          <div className="flex flex-col gap-1">
            {(
              [
                {
                  value: "copy",
                  label: "Import as a new copy",
                  hint: "— keeps both",
                },
                {
                  value: "overwrite",
                  label: "Replace mine",
                  hint: "— uses the incoming version",
                },
                {
                  value: "skip",
                  label: "Don't import",
                  hint: "— leaves mine alone",
                },
              ] as const
            ).map(({ value, label, hint }) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-[12px] has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="review-strategy"
                  checked={strategy === value}
                  onChange={() => onStrategyChange(value)}
                  className="accent-primary"
                />
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-muted-foreground">{hint}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-warning dark:text-warning">
          {notes.map((n, i) => (
            <li key={i}>⚠︎ {n}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        The PDF itself isn&apos;t bundled — it&apos;ll be re-fetched from the
        source the first time you open the review.
      </p>
    </div>
  );
}

interface WikiPreviewBodyProps {
  preview: WikiPreview;
  strategy: WikiCollisionStrategy;
  onStrategyChange: (next: WikiCollisionStrategy) => void;
}

function WikiPreviewBody({
  preview,
  strategy,
  onStrategyChange,
}: WikiPreviewBodyProps) {
  const { bundle, pagesTotal, collidingSlugs, newSlugs } = preview;
  const root = bundle.data.pages[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border/70 bg-card/50 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
          Journal entry
        </p>
        <p
          className="mt-0.5 truncate text-[13px] font-medium text-foreground"
          title={root?.title}
        >
          {root?.title ?? "(untitled)"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {pagesTotal} {pagesTotal === 1 ? "page" : "pages"} · {newSlugs.length}{" "}
          new, {collidingSlugs.length} already in your journal
        </p>
      </div>

      {collidingSlugs.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            {collidingSlugs.length === 1
              ? "One page already exists in your journal"
              : `${collidingSlugs.length} pages already exist in your journal`}
          </p>
          <div className="flex flex-col gap-1">
            {(
              [
                {
                  value: "skip",
                  label: "Keep mine",
                  hint: "— leaves existing pages alone",
                },
                {
                  value: "overwrite",
                  label: "Replace mine",
                  hint: "— uses the incoming versions",
                },
                {
                  value: "rename",
                  label: "Import alongside",
                  hint: "— adds them as new pages",
                },
              ] as const
            ).map(({ value, label, hint }) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-[12px] has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="wiki-strategy"
                  checked={strategy === value}
                  onChange={() => onStrategyChange(value)}
                  className="accent-primary"
                />
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-muted-foreground">{hint}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
