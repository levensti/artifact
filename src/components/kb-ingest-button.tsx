"use client";

import { useCallback, useState } from "react";
import { BookOpen, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import { getApiKey, isModelReady } from "@/lib/keys";
import { runKbIngest } from "@/lib/kb-ingest";
import { Button } from "@/components/ui/button";

type IngestState = "idle" | "running" | "done" | "error";

interface KbIngestButtonProps {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
}

export default function KbIngestButton({
  reviewId,
  paperTitle,
  paperContext,
  selectedModel,
}: KbIngestButtonProps) {
  const [state, setState] = useState<IngestState>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleIngest = useCallback(async () => {
    if (!selectedModel || !isModelReady(selectedModel)) return;
    setState("running");
    setProgress("Starting…");
    setError(null);
    setResult(null);

    try {
      const apiKey = isInferenceProviderType(selectedModel.provider)
        ? ""
        : (getApiKey(selectedModel.provider) ?? "");

      const res = await runKbIngest({
        reviewId,
        paperTitle,
        paperContext,
        model: selectedModel,
        apiKey,
        onProgress: setProgress,
      });
      setResult({ created: res.created, updated: res.updated });
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
      setState("error");
    }
  }, [reviewId, paperTitle, paperContext, selectedModel]);

  if (state === "done" && result) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" />
          <span>
            {result.created > 0 && `${result.created} created`}
            {result.created > 0 && result.updated > 0 && ", "}
            {result.updated > 0 && `${result.updated} updated`}
          </span>
        </div>
        <Link
          href="/kb"
          className="text-xs text-primary hover:underline"
        >
          View KB
        </Link>
      </div>
    );
  }

  if (state === "running") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span className="truncate max-w-[180px]">{progress}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={handleIngest}
        disabled={!selectedModel || !paperContext}
        title="Extract knowledge from this paper into your Knowledge Base"
      >
        <BookOpen className="size-3" />
        Distill to KB
      </Button>
      {state === "error" && error && (
        <span className="text-xs text-destructive truncate max-w-[160px]" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
