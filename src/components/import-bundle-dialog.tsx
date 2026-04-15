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

type Stage =
  | { kind: "pick" }
  | { kind: "loading" }
  | { kind: "preview"; preview: BundlePreview }
  | { kind: "error"; message: string }
  | { kind: "committing" }
  | { kind: "done"; message: string };

interface ImportBundleDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Single import entry point. Accepts both review and wiki bundles,
 * dispatching on `preview.kind`. Kept intentionally minimal — this is a
 * power-user path, not a core flow, so we favor clarity over chrome.
 */
export default function ImportBundleDialog({
  open,
  onClose,
}: ImportBundleDialogProps) {
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

  const handleFile = useCallback(async (file: File) => {
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
      setStage({ kind: "preview", preview: parsed.preview });
    } catch (err) {
      setStage({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to read file contents.",
      });
    }
  }, []);

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
            message: "Skipped — a review with this source is already in your library.",
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
          <DialogTitle>Import shared bundle</DialogTitle>
          <DialogDescription>
            Load a <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.json</code>{" "}
            file exported from another Artifact workspace.
          </DialogDescription>
        </DialogHeader>

        {stage.kind === "pick" && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <Upload className="size-5 text-muted-foreground" strokeWidth={1.75} />
              <span className="text-[13px] font-medium text-foreground">
                Choose a bundle file
              </span>
              <span className="text-[11px] text-muted-foreground">
                review-*.json or journal-*.json
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
            <FileDown className="size-5 text-emerald-600" strokeWidth={1.75} />
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
  preview: Extract<BundlePreview, { kind: "review" }>;
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
        <p className="mt-0.5 truncate text-[13px] font-medium text-foreground" title={review.title}>
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

      <ul className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <li>
          <span className="font-semibold tabular-nums text-foreground">
            {counts.messages}
          </span>{" "}
          messages
        </li>
        <li>
          <span className="font-semibold tabular-nums text-foreground">
            {counts.annotations}
          </span>{" "}
          annotations
        </li>
        <li>
          <span className="font-semibold tabular-nums text-foreground">
            {counts.deepDives}
          </span>{" "}
          deep dives
        </li>
        <li>
          <span className="font-semibold tabular-nums text-foreground">
            {counts.graphNodes}
          </span>{" "}
          graph nodes
        </li>
      </ul>

      {hasCollision ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            This review already exists in your library
          </p>
          <div className="flex flex-col gap-1">
            {(["copy", "overwrite", "skip"] as const).map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-[12px] has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="review-strategy"
                  checked={strategy === opt}
                  onChange={() => onStrategyChange(opt)}
                  className="accent-primary"
                />
                <span className="font-medium text-foreground capitalize">
                  {opt === "copy"
                    ? "Import as copy"
                    : opt === "overwrite"
                    ? "Overwrite"
                    : "Skip"}
                </span>
                <span className="text-muted-foreground">
                  {opt === "copy"
                    ? "— keeps both"
                    : opt === "overwrite"
                    ? "— replaces existing"
                    : "— do nothing"}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
          {notes.map((n, i) => (
            <li key={i}>⚠︎ {n}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        The PDF isn&apos;t included — it&apos;ll be re-fetched from the
        source on first view.
      </p>
    </div>
  );
}

interface WikiPreviewBodyProps {
  preview: Extract<BundlePreview, { kind: "wiki" }>;
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
        <p className="mt-0.5 truncate text-[13px] font-medium text-foreground" title={root?.title}>
          {root?.title ?? "(untitled)"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {pagesTotal} {pagesTotal === 1 ? "page" : "pages"} total ·{" "}
          {newSlugs.length} new, {collidingSlugs.length} existing
        </p>
      </div>

      {collidingSlugs.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            {collidingSlugs.length === 1
              ? "1 page already exists"
              : `${collidingSlugs.length} pages already exist`}
          </p>
          <div className="flex flex-col gap-1">
            {(["skip", "overwrite", "rename"] as const).map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-[12px] has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="wiki-strategy"
                  checked={strategy === opt}
                  onChange={() => onStrategyChange(opt)}
                  className="accent-primary"
                />
                <span className="font-medium text-foreground capitalize">
                  {opt === "skip"
                    ? "Skip existing"
                    : opt === "overwrite"
                    ? "Overwrite"
                    : "Rename"}
                </span>
                <span className="text-muted-foreground">
                  {opt === "skip"
                    ? "— keep my version"
                    : opt === "overwrite"
                    ? "— replace with imported"
                    : "— import as new page"}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
