"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  loadWikiRevision,
  type WikiRevision,
  type WikiRevisionSummary,
} from "@/lib/client-data";
import { cn } from "@/lib/utils";

interface WikiRevisionDialogProps {
  currentTitle: string;
  currentContent: string;
  revisions: WikiRevisionSummary[];
  initialRevisionId: number;
  onClose: () => void;
}

/** LCS-based line diff. Returns an array of { kind, text } segments. */
interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  // Compute LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk to produce diff
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: "del", text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ kind: "add", text: b[j] });
    j++;
  }
  return out;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Revision-history + diff-on-update viewer. Given a page's revision
 * summaries, lets the user pick any historical snapshot and see a
 * line-level diff against the current content.
 *
 * "Look what the agent did" made visible.
 */
export default function WikiRevisionDialog({
  currentTitle,
  currentContent,
  revisions,
  initialRevisionId,
  onClose,
}: WikiRevisionDialogProps) {
  const [selectedId, setSelectedId] = useState<number>(initialRevisionId);
  // Scope fetched revision to the id it was loaded for; used to compute
  // `loading` without needing a separate setState inside the effect.
  const [revEntry, setRevEntry] = useState<{
    id: number;
    data: WikiRevision | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWikiRevision(selectedId).then((r) => {
      if (!cancelled) setRevEntry({ id: selectedId, data: r });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const rev = revEntry && revEntry.id === selectedId ? revEntry.data : null;
  const loading = revEntry === null || revEntry.id !== selectedId;

  const diff = useMemo(() => {
    if (!rev) return [];
    return lineDiff(rev.content, currentContent);
  }, [rev, currentContent]);

  const addedCount = diff.filter((d) => d.kind === "add").length;
  const removedCount = diff.filter((d) => d.kind === "del").length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="!max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span>Revision history</span>
            <span className="text-muted-foreground font-normal">
              · {currentTitle}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* Revision list */}
          <aside className="w-[180px] shrink-0 overflow-y-auto border-r border-border pr-3">
            <ul className="space-y-0.5">
              {revisions.map((r, idx) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-tight transition-colors",
                      r.id === selectedId
                        ? "bg-primary/10 text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <div>{idx === 0 ? "Previous" : `#${r.id}`}</div>
                    <div className="text-[10px] opacity-70">
                      {formatWhen(r.savedAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Diff pane */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {loading && !rev ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground text-xs">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading
                revision…
              </div>
            ) : !rev ? (
              <div className="text-muted-foreground text-xs">
                Revision not found.
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {formatWhen(rev.savedAt)}
                    <ArrowRight className="size-3" />
                    now
                  </span>
                  <span className="text-emerald-600">+{addedCount}</span>
                  <span className="text-rose-600">−{removedCount}</span>
                </div>
                {addedCount === 0 && removedCount === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
                    No changes since this revision — the current page is
                    identical to this snapshot.
                  </div>
                ) : null}
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                  {diff.map((line, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "px-2 py-px -mx-2",
                        line.kind === "add" &&
                          "bg-emerald-500/10 text-emerald-700",
                        line.kind === "del" &&
                          "bg-rose-500/10 text-rose-700 line-through decoration-rose-400/60",
                      )}
                    >
                      <span className="mr-1 select-none opacity-50">
                        {line.kind === "add"
                          ? "+"
                          : line.kind === "del"
                            ? "−"
                            : " "}
                      </span>
                      {line.text || "\u00a0"}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
