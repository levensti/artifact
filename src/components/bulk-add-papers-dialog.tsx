"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { bulkAddPapers, type BulkAddResult } from "@/lib/projects";
import { refreshReviews } from "@/lib/client-data";
import { cn } from "@/lib/utils";

interface BulkAddPapersDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onAdded: () => void;
}

export default function BulkAddPapersDialog({
  open,
  onClose,
  projectId,
  projectName,
  onAdded,
}: BulkAddPapersDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkAddResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setResult(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Split on whitespace OR commas; the user could paste a CSV row, a
  // newline list, or a single line of space-separated URLs and we
  // accept all of them.
  const items = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const submit = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await bulkAddPapers(projectId, items);
      setResult(r);
      // Refresh the reviews cache so the workspace + sidebar pick up
      // any newly-created reviews.
      await refreshReviews();
      onAdded();
      // If no failures and we added at least one, auto-dismiss.
      if (r.failed.length === 0 && r.added + r.reused > 0) {
        setTimeout(() => onClose(), 800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add papers");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add papers in bulk</DialogTitle>
          <DialogDescription>
            Paste arXiv URLs or IDs — one per line, or comma-separated. They
            land in “{projectName}” as new reviews.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={`https://arxiv.org/abs/2402.00277\n2304.11277\nhttps://arxiv.org/pdf/2106.09685`}
          disabled={busy}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] outline-none transition focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/50"
        />
        <p className="text-[11px] text-muted-foreground/70">
          {items.length === 0
            ? "Drop in any number of papers — we'll fetch titles for you."
            : `${items.length} ${items.length === 1 ? "entry" : "entries"} ready.`}
        </p>

        {result ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px]">
            <div className="flex items-center gap-1.5 text-foreground">
              <Check className="size-3.5 text-primary" strokeWidth={2} />
              Added {result.added}
              {result.reused > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  · reused {result.reused} existing
                </span>
              ) : null}
              {result.failed.length > 0 ? (
                <span className="text-destructive">
                  {" "}
                  · {result.failed.length} failed
                </span>
              ) : null}
            </div>
            {result.failed.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {result.failed.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-destructive/90"
                  >
                    <AlertTriangle
                      className="mt-px size-3 shrink-0"
                      strokeWidth={2}
                    />
                    <span className="font-mono">{f.input}</span>
                    <span className="text-muted-foreground">— {f.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            disabled={busy || items.length === 0}
            className={cn(busy && "opacity-90")}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add {items.length > 0 ? `${items.length} ` : ""}papers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
