"use client";

import { Check, Loader2, AlertCircle } from "lucide-react";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import { cn } from "@/lib/utils";

interface AnalysisStatusBadgeProps {
  status: AnalysisStatus;
  progress: string | null;
  onRetrigger?: () => void;
}

export default function AnalysisStatusBadge({
  status,
  progress,
  onRetrigger,
}: AnalysisStatusBadgeProps) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] rounded-full px-2 py-0.5 shrink-0 transition-colors",
        status === "running" && "bg-primary/10 text-primary",
        status === "done" && "bg-emerald-100/60 text-emerald-800",
        status === "error" && "bg-destructive/10 text-destructive cursor-pointer hover:bg-destructive/15",
      )}
      onClick={status === "error" ? onRetrigger : undefined}
      title={
        status === "error"
          ? "Click to retry analysis"
          : status === "running"
            ? (progress ?? "Analyzing…")
            : "Analysis complete"
      }
    >
      {status === "running" && <Loader2 className="size-3 animate-spin" />}
      {status === "done" && <Check className="size-3" />}
      {status === "error" && <AlertCircle className="size-3" />}
      <span className="truncate max-w-[120px]">
        {status === "running"
          ? (progress ?? "Analyzing…")
          : status === "done"
            ? "Analyzed"
            : "Retry"}
      </span>
    </div>
  );
}
