"use client";

import { useCallback, useState } from "react";
import { Loader2, Settings, Sparkles } from "lucide-react";
import type { Model } from "@/lib/models";
import { getApiKey } from "@/lib/keys";
import type { Prerequisite } from "@/lib/explore";
import { getPrerequisites, savePrerequisites } from "@/lib/explore";
import { useExploreData } from "@/hooks/use-explore-data";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import PrerequisitesSection from "@/components/prerequisites-section";
import MarkdownMessage from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveDeepDive } from "@/lib/deep-dives";

async function generateStudyMarkdown(
  model: Model,
  apiKey: string,
  prompt: string,
  paperContext: string,
): Promise<string> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.modelId,
      provider: model.provider,
      apiKey,
      prompt,
      paperContext,
    }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  const data = await response.json();
  return String(data.content ?? "");
}

interface PrerequisitesPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
  onAskAbout?: (topic: string) => void;
  analysisStatus: AnalysisStatus;
  analysisProgress: string | null;
  analysisError: string | null;
  canRunAnalysis: boolean;
  onTriggerAnalysis: () => boolean;
  onOpenSettings: () => void;
}

export default function PrerequisitesPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
  onAskAbout,
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  onTriggerAnalysis,
  onOpenSettings,
}: PrerequisitesPanelProps) {
  const { prerequisites: prereqData } = useExploreData(reviewId);
  const [loadingTopicId, setLoadingTopicId] = useState<string | null>(null);
  const [studyItem, setStudyItem] = useState<Prerequisite | null>(null);

  const openStudyGuide = useCallback(
    async (item: Prerequisite) => {
      setStudyItem(item);
      if (item.explanation) return;
      if (!selectedModel) return;
      const apiKey = getApiKey(selectedModel.provider);
      const snapshot = getPrerequisites(reviewId);
      if (!apiKey || !snapshot) return;

      setLoadingTopicId(item.id);
      try {
        const divePrompt = `Write a **prerequisite deep-dive** on the concept below for a technical reader who is preparing to read the paper (full text in your context).

Concept: ${JSON.stringify(item.topic)}
Paper title (anchor only): ${JSON.stringify(paperTitle)}

Use Markdown with these sections (keep total readable in ~3–5 minutes):
## Intuition
## Formal picture
Use $...$ or $$...$$ for math where helpful.
## How this paper uses it
Tie back to specific goals/methods in the paper (no vague hand-waving).
## Common pitfalls
2 short bullets.
## What to skim next
1 bullet: what to look for when reading the paper or a canonical reference.

Stay factual; if the paper text does not support a claim, say that it is a typical use in the area rather than attributing to the paper.`;

        const explanation = await generateStudyMarkdown(
          selectedModel,
          apiKey,
          divePrompt,
          paperContext,
        );
        const next = {
          ...snapshot,
          prerequisites: snapshot.prerequisites.map((p) =>
            p.id === item.id ? { ...p, explanation } : p,
          ),
        };
        savePrerequisites(reviewId, next);
        saveDeepDive({
          reviewId,
          paperTitle,
          arxivId,
          topic: item.topic,
          explanation,
        });
        setStudyItem({ ...item, explanation });
      } finally {
        setLoadingTopicId(null);
      }
    },
    [arxivId, paperContext, paperTitle, reviewId, selectedModel],
  );

  const handleToggleComplete = useCallback(
    (id: string, completed: boolean) => {
      if (!prereqData) return;
      const next = {
        ...prereqData,
        prerequisites: prereqData.prerequisites.map((p) =>
          p.id === id
            ? { ...p, completedAt: completed ? new Date().toISOString() : undefined }
            : p,
        ),
      };
      savePrerequisites(reviewId, next);
    },
    [prereqData, reviewId],
  );

  // Empty state: show CTA to analyze or configure
  if (!prereqData || prereqData.prerequisites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center gap-3 px-4">
        {analysisStatus === "running" ? (
          <>
            <Loader2 className="size-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">
              {analysisProgress ?? "Analyzing paper…"}
            </p>
          </>
        ) : (
          <>
            <Sparkles className="size-8 text-muted-foreground/40" />
            <div className="space-y-2 max-w-[280px]">
              <p className="text-sm font-medium text-foreground">
                Recommended pre-reading
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Analyze this paper to find topics and papers worth reading beforehand, and build a checklist to track your progress.
              </p>

              {analysisError && (
                <p className="text-xs text-destructive leading-relaxed">
                  {analysisError}
                </p>
              )}

              {!selectedModel ? (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    Select a model and add an API key to get started.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={onOpenSettings}
                  >
                    <Settings className="size-3.5 mr-1.5" />
                    Open settings
                  </Button>
                </div>
              ) : !canRunAnalysis ? (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    Add an API key for {selectedModel.label} to run analysis.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={onOpenSettings}
                  >
                    <Settings className="size-3.5 mr-1.5" />
                    Add API key
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="h-8 text-xs mt-1"
                  onClick={onTriggerAnalysis}
                >
                  <Sparkles className="size-3.5 mr-1.5" />
                  Analyze paper
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {/* Re-analyze button when analysis is done and prereqs exist */}
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onTriggerAnalysis}
          disabled={!canRunAnalysis || analysisStatus === "running"}
        >
          {analysisStatus === "running" ? (
            <>
              <Loader2 className="size-3 mr-1 animate-spin" />
              {analysisProgress ?? "Analyzing…"}
            </>
          ) : (
            <>
              <Sparkles className="size-3 mr-1" />
              Re-analyze
            </>
          )}
        </Button>
      </div>

      <PrerequisitesSection
        prerequisites={prereqData.prerequisites}
        loadingTopicId={loadingTopicId}
        onOpenStudy={(item) => {
          void openStudyGuide(item);
        }}
        onToggleComplete={handleToggleComplete}
        onAskAbout={onAskAbout}
      />

      <Dialog open={studyItem !== null} onOpenChange={(open) => !open && setStudyItem(null)}>
        <DialogContent className="max-w-lg max-h-[min(85vh,720px)] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="text-left pr-8">{studyItem?.topic}</DialogTitle>
            <DialogDescription className="text-left text-xs">
              Study guide for this prerequisite. Mark it done in the checklist when you feel ready.
            </DialogDescription>
          </DialogHeader>
          {studyItem && loadingTopicId === studyItem.id && !studyItem.explanation ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Generating study guide…
            </div>
          ) : (
            studyItem?.explanation && (
              <div className="text-sm border border-border/80 rounded-md p-3 bg-muted/20">
                <MarkdownMessage content={studyItem.explanation} />
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
