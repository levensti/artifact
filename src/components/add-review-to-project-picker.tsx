"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, FileText, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REVIEWS_UPDATED_EVENT,
  getReviews,
  type PaperReview,
} from "@/lib/reviews";
import { addReviewToProject } from "@/lib/projects";
import { hydrateClientStore } from "@/lib/client-data";
import { cn } from "@/lib/utils";

interface AddReviewToProjectPickerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /// Reviews already in this project — they appear greyed out and
  /// pre-checked (and disabled) so the picker is also a "what's
  /// already in here" reference.
  existingMemberIds: string[];
  onAdded: () => void;
}

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
}

function snapshot() {
  return JSON.stringify(getReviews());
}

function serverSnapshot() {
  return "[]";
}

export default function AddReviewToProjectPicker({
  open,
  onClose,
  projectId,
  projectName,
  existingMemberIds,
  onAdded,
}: AddReviewToProjectPickerProps) {
  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    snapshot,
    serverSnapshot,
  );
  const allReviews = useMemo(
    () => JSON.parse(reviewsJson) as PaperReview[],
    [reviewsJson],
  );
  const memberSet = useMemo(
    () => new Set(existingMemberIds),
    [existingMemberIds],
  );

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPicked(new Set());
      setError(null);
      setBusy(false);
    } else {
      void hydrateClientStore();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allReviews;
    return allReviews.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.arxivId ?? "").toLowerCase().includes(q),
    );
  }, [allReviews, query]);

  const toggle = (id: string) => {
    if (memberSet.has(id)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Sequential adds — typically 1–10 at a time, no need to batch on
      // the wire. Errors halt and surface so the user can fix and retry.
      for (const reviewId of picked) {
        await addReviewToProject(projectId, reviewId);
      }
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reviews");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add reviews</DialogTitle>
          <DialogDescription>
            Pick existing reviews to add to “{projectName}”.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or arXiv ID…"
            className="pl-7"
          />
        </div>

        <div className="-mx-1 max-h-[40vh] overflow-y-auto px-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <FileText
                className="size-5 text-muted-foreground/50"
                strokeWidth={1.5}
              />
              <p className="text-[12px] text-muted-foreground/80">
                {allReviews.length === 0
                  ? "You don’t have any reviews yet."
                  : "No reviews match that search."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((r) => {
                const isMember = memberSet.has(r.id);
                const checked = isMember || picked.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    disabled={isMember}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      isMember
                        ? "cursor-default opacity-60"
                        : checked
                          ? "bg-primary/10 text-foreground"
                          : "text-foreground/85 hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-transparent",
                      )}
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {r.title}
                    </span>
                    {isMember ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        Added
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || picked.size === 0}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add {picked.size > 0 ? `${picked.size} ` : ""}
            {picked.size === 1 ? "review" : "reviews"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
