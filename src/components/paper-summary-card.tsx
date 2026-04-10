"use client";

import { useState, useCallback } from "react";
import {
  BookOpen,
  Pencil,
  Check,
  X,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { PaperReview, PaperSummary } from "@/lib/review-types";
import { saveSummary } from "@/lib/client-data";
import { Button } from "@/components/ui/button";

interface PaperSummaryCardProps {
  review: PaperReview;
  onNavigate: (id: string) => void;
}

export default function PaperSummaryCard({
  review,
  onNavigate,
}: PaperSummaryCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PaperSummary>({
    takeaway: review.summary?.takeaway ?? "",
    method: review.summary?.method ?? "",
    result: review.summary?.result ?? "",
    notes: review.summary?.notes ?? "",
  });

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const hasContent = draft.takeaway || draft.method || draft.result || draft.notes;
      await saveSummary(review.id, hasContent ? draft : null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [review.id, draft]);

  const handleCancel = useCallback(() => {
    setDraft({
      takeaway: review.summary?.takeaway ?? "",
      method: review.summary?.method ?? "",
      result: review.summary?.result ?? "",
      notes: review.summary?.notes ?? "",
    });
    setEditing(false);
  }, [review.summary]);

  const hasSummary = review.summary && (
    review.summary.takeaway || review.summary.method ||
    review.summary.result || review.summary.notes
  );

  const daysSince = Math.floor(
    (Date.now() - new Date(review.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div
      className="group rounded-lg border border-border bg-card p-4 transition-all duration-200 hover:border-border/90"
      style={{ boxShadow: "var(--shadow-panel)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate(review.id)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
            <BookOpen className="size-4 text-foreground/60" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug text-foreground line-clamp-2 group-hover:text-primary transition-colors">
              {review.title}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {review.arxivId ? `arXiv:${review.arxivId}` : "Local PDF"}
              {daysSince > 0 && ` · ${daysSince}d ago`}
            </p>
          </div>
        </button>

        {!editing && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
            title={hasSummary ? "Edit summary" : "Add summary"}
          >
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
          <SummaryField
            label="Key takeaway"
            value={draft.takeaway}
            onChange={(v) => setDraft({ ...draft, takeaway: v })}
            placeholder="What's the one thing to remember?"
          />
          <SummaryField
            label="Method"
            value={draft.method}
            onChange={(v) => setDraft({ ...draft, method: v })}
            placeholder="How did they do it?"
          />
          <SummaryField
            label="Result"
            value={draft.result}
            onChange={(v) => setDraft({ ...draft, result: v })}
            placeholder="What did they find?"
          />
          <SummaryField
            label="Notes"
            value={draft.notes}
            onChange={(v) => setDraft({ ...draft, notes: v })}
            placeholder="Your thoughts, questions, connections..."
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCancel}
              disabled={saving}
            >
              <X className="size-3 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Check className="size-3 mr-1" />
              )}
              Save
            </Button>
          </div>
        </div>
      ) : hasSummary ? (
        <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {review.summary!.takeaway && (
            <SummaryLine icon={Sparkles} label="Takeaway" text={review.summary!.takeaway} />
          )}
          {review.summary!.method && (
            <SummaryLine label="Method" text={review.summary!.method} />
          )}
          {review.summary!.result && (
            <SummaryLine label="Result" text={review.summary!.result} />
          )}
          {review.summary!.notes && (
            <SummaryLine label="Notes" text={review.summary!.notes} muted />
          )}
        </div>
      ) : null}
    </div>
  );
}

function SummaryField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={1}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-ring/40"
      />
    </div>
  );
}

function SummaryLine({
  icon: Icon,
  label,
  text,
  muted,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      {Icon && <Icon className="size-3 shrink-0 text-primary/60 relative top-0.5" strokeWidth={1.75} />}
      <span className="text-[11px] font-medium text-muted-foreground shrink-0">{label}:</span>
      <span className={`text-xs leading-snug ${muted ? "text-muted-foreground italic" : "text-foreground/85"}`}>
        {text}
      </span>
    </div>
  );
}
