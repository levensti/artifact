"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import type { Model } from "@/lib/models";
import { getApiKey } from "@/lib/keys";
import type { Prerequisite } from "@/lib/explore";
import { savePrerequisites } from "@/lib/client-data";
import { useExploreData } from "@/hooks/use-explore-data";
import PrerequisitesSection from "@/components/prerequisites-section";
import RelatedWorksGraph from "@/components/related-works-graph";
import MarkdownMessage from "@/components/markdown-message";
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

interface LearningEmbedProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
}

export default function LearningEmbed({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
}: LearningEmbedProps) {
  const { prerequisites: prereqData, graph: graphData } =
    useExploreData(reviewId);

  const [loadingTopicId, setLoadingTopicId] = useState<string | null>(null);
  const [studyItem, setStudyItem] = useState<Prerequisite | null>(null);

  const openStudyGuide = useCallback(
    async (item: Prerequisite) => {
      setStudyItem(item);
      if (item.explanation) return;
      if (!selectedModel) return;
      const apiKey = getApiKey(selectedModel.provider);
      const snapshot = prereqData;
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
        await savePrerequisites(reviewId, next);
        await saveDeepDive({
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
    [arxivId, paperContext, paperTitle, prereqData, reviewId, selectedModel],
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
      void savePrerequisites(reviewId, next);
    },
    [prereqData, reviewId],
  );

  if (!prereqData && !graphData) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Nothing saved yet. Use <span className="font-medium text-foreground/85">Build learning map</span>{" "}
        above to generate prerequisites and a related-works graph for this paper.
      </p>
    );
  }

  const hasMap = graphData != null;

  return (
    <div className="space-y-4 pt-1">
      {prereqData && prereqData.prerequisites.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary shrink-0" />
            <h4 className="text-sm font-semibold text-foreground">Prerequisites</h4>
          </div>
          <PrerequisitesSection
            prerequisites={prereqData.prerequisites}
            loadingTopicId={loadingTopicId}
            onOpenStudy={(item) => {
              void openStudyGuide(item);
            }}
            onToggleComplete={handleToggleComplete}
          />
        </section>
      )}

      {graphData && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground">Related works</h4>
            {hasMap && (
              <Link
                href="/discover"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
              >
                Knowledge Graph
                <ExternalLink className="size-3 opacity-70" />
              </Link>
            )}
          </div>
          <RelatedWorksGraph graph={graphData} />
        </section>
      )}

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
