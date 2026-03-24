"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import ModelSelector from "@/components/model-selector";
import { getApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import { PROVIDER_META, type Model } from "@/lib/models";
import {
  clearExploreData,
  getGraphData,
  getPrerequisites,
  saveGraphData,
  savePrerequisites,
  type ArxivSearchResult,
  type GraphData,
  type GraphNode,
  type Prerequisite,
  type PrerequisitesData,
  type RelationshipType,
} from "@/lib/explore";
import PrerequisitesSection from "@/components/prerequisites-section";
import RelatedWorksGraph from "@/components/related-works-graph";
import { useSettingsOpener } from "@/components/settings-opener-context";

type ExplorePhase =
  | "idle"
  | "generating_prerequisites"
  | "extracting_keywords"
  | "searching_arxiv"
  | "classifying"
  | "complete"
  | "error";

interface ExplorePanelProps {
  reviewId: string;
  paperContext: string;
  paperTitle: string;
  arxivId: string;
}

interface Classification {
  arxivId: string;
  relationship: RelationshipType;
  reasoning: string;
  relevant: boolean;
}

const PHASE_LABELS: Array<{ key: ExplorePhase; label: string }> = [
  { key: "generating_prerequisites", label: "Identifying prerequisites" },
  { key: "extracting_keywords", label: "Extracting search keywords" },
  { key: "searching_arxiv", label: "Searching arXiv" },
  { key: "classifying", label: "Classifying relationships" },
];

const VALID_DIFFICULTIES = new Set(["foundational", "intermediate", "advanced"]);
const VALID_RELATIONSHIPS = new Set([
  "builds-upon",
  "extends",
  "similar-approach",
  "prerequisite",
  "contrasts-with",
  "surveys",
]);

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

async function generateStructured(
  model: Model,
  apiKey: string,
  prompt: string,
  paperContext: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
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

export default function ExplorePanel({
  reviewId,
  paperContext,
  paperTitle,
  arxivId,
}: ExplorePanelProps) {
  const { openSettings } = useSettingsOpener();
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [phase, setPhase] = useState<ExplorePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadingTopicId, setLoadingTopicId] = useState<string | null>(null);
  const [prerequisitesData, setPrerequisitesData] = useState<PrerequisitesData | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const [retryPhase, setRetryPhase] = useState<ExplorePhase>("generating_prerequisites");
  const [classifyCandidates, setClassifyCandidates] = useState<ArxivSearchResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const analysisRunning =
    phase === "generating_prerequisites" ||
    phase === "extracting_keywords" ||
    phase === "searching_arxiv" ||
    phase === "classifying";

  useEffect(() => {
    const prereq = getPrerequisites(reviewId);
    const graph = getGraphData(reviewId);
    setPrerequisitesData(prereq);
    setGraphData(graph);
    setPhase(prereq && graph ? "complete" : "idle");
  }, [reviewId]);

  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  void keysVersion;
  const hasKeyForModel =
    selectedModel != null && !!getApiKey(selectedModel.provider);

  const runAnalysis = useCallback(async () => {
    if (!selectedModel) return;
    if (!paperContext.trim()) {
      setError("Paper text is still loading. Wait for the PDF text extraction to finish.");
      return;
    }
    const apiKey = getApiKey(selectedModel.provider);
    if (!apiKey) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    try {
      const startFrom =
        phase === "error" &&
        retryPhase !== "idle" &&
        retryPhase !== "complete" &&
        retryPhase !== "error"
          ? retryPhase
          : "generating_prerequisites";

      let localKeywords = graphData?.keywords ?? [];
      let localCandidates = classifyCandidates;

      if (startFrom === "generating_prerequisites") {
        setPhase("generating_prerequisites");
        const prereqPrompt = `Identify 5-8 key concepts a reader should understand before reading this paper.
Return strict JSON with this shape:
{"prerequisites":[{"topic":"...","description":"...","difficulty":"foundational|intermediate|advanced"}]}
Keep each description to 2-3 sentences.`;
        const prereqRaw = await generateStructured(
          selectedModel,
          apiKey,
          prereqPrompt,
          paperContext,
          controller.signal,
        );
        const parsedPrereq = parseJson<{ prerequisites: Array<Omit<Prerequisite, "id">> }>(
          prereqRaw,
          { prerequisites: [] },
        );
        if (parsedPrereq.prerequisites.length === 0) {
          throw new Error("Could not parse prerequisites from model output. Try another run.");
        }
        const normalizedPrereq: PrerequisitesData = {
          prerequisites: parsedPrereq.prerequisites.slice(0, 8).map((item) => ({
            id: crypto.randomUUID(),
            topic: item.topic,
            description: item.description,
            difficulty: VALID_DIFFICULTIES.has(item.difficulty)
              ? item.difficulty
              : "intermediate",
          })),
          generatedAt: new Date().toISOString(),
          modelUsed: selectedModel.label,
        };
        setPrerequisitesData(normalizedPrereq);
        savePrerequisites(reviewId, normalizedPrereq);
      }

      if (startFrom === "generating_prerequisites" || startFrom === "extracting_keywords") {
        setPhase("extracting_keywords");
        const keywordRaw = await generateStructured(
          selectedModel,
          apiKey,
          'Generate 5-8 arXiv search queries for finding related papers. Return a strict JSON string array like ["keyword one","keyword two"].',
          paperContext,
          controller.signal,
        );
        localKeywords = parseJson<string[]>(keywordRaw, []).slice(0, 8);
        if (localKeywords.length === 0) {
          throw new Error("Could not parse search keywords from model output. Try another run.");
        }
      }

      if (
        startFrom === "generating_prerequisites" ||
        startFrom === "extracting_keywords" ||
        startFrom === "searching_arxiv"
      ) {
        setPhase("searching_arxiv");
        const query =
          localKeywords.length > 0
            ? localKeywords.map((k) => `all:${k}`).join(" OR ")
            : `all:${paperTitle}`;
        const arxivRes = await fetch(
          `/api/arxiv-search?query=${encodeURIComponent(query)}&max_results=16`,
          { signal: controller.signal },
        );
        if (!arxivRes.ok) {
          const data = await arxivRes.json();
          throw new Error(data.error || "Failed to query arXiv.");
        }
        const arxivData = (await arxivRes.json()) as { results: ArxivSearchResult[] };
        localCandidates = arxivData.results
          .filter((c) => c.arxivId !== arxivId)
          .slice(0, 14);
        setClassifyCandidates(localCandidates);
      }

      setPhase("classifying");

      if (localCandidates.length === 0) {
        const currentOnlyGraph: GraphData = {
          nodes: [
            {
              id: `current-${reviewId}`,
              title: paperTitle,
              authors: [],
              abstract: "No related candidates found for this query.",
              arxivId,
              publishedDate: new Date().toISOString(),
              categories: [],
              isCurrent: true,
            },
          ],
          edges: [],
          keywords: localKeywords,
          generatedAt: new Date().toISOString(),
          modelUsed: selectedModel.label,
        };
        setGraphData(currentOnlyGraph);
        saveGraphData(reviewId, currentOnlyGraph);
        setPhase("complete");
        return;
      }

      const classifyPrompt = `Given the main paper and candidate papers, classify relationships.
Main paper title: ${paperTitle}
Main arXiv id: ${arxivId}
Candidates:
${JSON.stringify(localCandidates, null, 2)}

Return strict JSON array:
[{"arxivId":"...","relationship":"builds-upon|extends|similar-approach|prerequisite|contrasts-with|surveys","reasoning":"...","relevant":true}]
Only mark relevant=true if this paper should be included in a concise graph.`;
      const clsRaw = await generateStructured(
        selectedModel,
        apiKey,
        classifyPrompt,
        paperContext,
        controller.signal,
      );
      const classifications = parseJson<Classification[]>(clsRaw, [])
        .filter((c) => c.relevant)
        .filter((c) => VALID_RELATIONSHIPS.has(c.relationship));
      if (classifications.length === 0) {
        throw new Error("No relevant relationships were parsed from model output.");
      }

      const currentNode: GraphNode = {
        id: `current-${reviewId}`,
        title: paperTitle,
        authors: [],
        abstract: "The paper currently being reviewed.",
        arxivId,
        publishedDate: new Date().toISOString(),
        categories: [],
        isCurrent: true,
      };

      const candidateById = new Map(localCandidates.map((item) => [item.arxivId, item]));
      const chosen = classifications
        .map((c) => {
          const item = candidateById.get(c.arxivId);
          if (!item) return null;
          return {
            cls: c,
            node: {
              id: item.arxivId,
              title: item.title,
              authors: item.authors,
              abstract: item.abstract,
              arxivId: item.arxivId,
              publishedDate: item.publishedDate,
              categories: item.categories,
              isCurrent: false,
            } as GraphNode,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
        .slice(0, 10);

      const graph: GraphData = {
        nodes: [currentNode, ...chosen.map((item) => item.node)],
        edges: chosen.map((item) => ({
          source: currentNode.id,
          target: item.node.id,
          relationship: item.cls.relationship,
          reasoning: item.cls.reasoning,
        })),
        keywords: localKeywords,
        generatedAt: new Date().toISOString(),
        modelUsed: selectedModel.label,
      };

      setGraphData(graph);
      saveGraphData(reviewId, graph);
      setRetryPhase("generating_prerequisites");
      setPhase("complete");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (phase === "extracting_keywords") setRetryPhase("extracting_keywords");
      else if (phase === "searching_arxiv") setRetryPhase("searching_arxiv");
      else if (phase === "classifying") setRetryPhase("classifying");
      else setRetryPhase("generating_prerequisites");
      setPhase("error");
      setError(err instanceof Error ? err.message : "Failed to analyze paper.");
    }
  }, [
    arxivId,
    classifyCandidates,
    graphData?.keywords,
    paperContext,
    paperTitle,
    phase,
    retryPhase,
    reviewId,
    selectedModel,
  ]);

  const handleLearnMore = useCallback(
    async (item: Prerequisite) => {
      if (!selectedModel) return;
      const apiKey = getApiKey(selectedModel.provider);
      if (!apiKey || !prerequisitesData) return;

      setLoadingTopicId(item.id);
      setError(null);
      try {
        const explanation = await generateStructured(
          selectedModel,
          apiKey,
          `Explain "${item.topic}" in the context of this paper titled "${paperTitle}". Assume the reader is technical but unfamiliar with this concept. Use concise structure and LaTeX for math.`,
          paperContext,
        );

        const next: PrerequisitesData = {
          ...prerequisitesData,
          prerequisites: prerequisitesData.prerequisites.map((p) =>
            p.id === item.id ? { ...p, explanation } : p,
          ),
        };
        setPrerequisitesData(next);
        savePrerequisites(reviewId, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate explanation.");
      } finally {
        setLoadingTopicId(null);
      }
    },
    [paperContext, paperTitle, prerequisitesData, reviewId, selectedModel],
  );

  const progress = useMemo(() => {
    const idx = PHASE_LABELS.findIndex((x) => x.key === phase);
    return PHASE_LABELS.map((item, i) => {
      if (phase === "complete") return "done";
      if (idx === -1) return "pending";
      if (i < idx) return "done";
      if (i === idx) return "active";
      return "pending";
    });
  }, [phase]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">Explore this paper</p>
              <p className="text-xs text-muted-foreground mt-1">
                Build prerequisites and a related-works graph with AI + arXiv.
              </p>
            </div>
            <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (
                  phase === "complete" &&
                  (prerequisitesData?.prerequisites.some((p) => !!p.explanation) ?? false) &&
                  !window.confirm("Re-analyze and overwrite current Explore results?")
                ) {
                  return;
                }
                void runAnalysis();
              }}
              disabled={!selectedModel || !hasKeyForModel || analysisRunning}
            >
              {analysisRunning ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Telescope className="size-4 mr-1.5" />
              )}
              {phase === "complete" ? "Re-analyze paper" : "Analyze paper"}
            </Button>
            {(prerequisitesData || graphData) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearExploreData(reviewId);
                  setPrerequisitesData(null);
                  setGraphData(null);
                  setPhase("idle");
                  setError(null);
                }}
              >
                Clear cache
              </Button>
            )}
          </div>

          {selectedModel && !hasKeyForModel && (
            <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              {PROVIDER_META[selectedModel.provider].keyHint} required.
              <button
                type="button"
                className="underline ml-1"
                onClick={() => openSettings({ provider: selectedModel.provider })}
              >
                Add API key
              </button>
            </div>
          )}
        </div>

        {(phase !== "idle" || prerequisitesData || graphData) && (
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Progress</p>
            <div className="space-y-1.5">
              {PHASE_LABELS.map((item, i) => {
                const status = progress[i];
                return (
                  <div key={item.key} className="text-xs flex items-center gap-2">
                    <span className="inline-flex w-4 justify-center">
                      {status === "done" ? (
                        "✓"
                      ) : status === "active" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "○"
                      )}
                    </span>
                    <span className={status === "pending" ? "text-muted-foreground" : "text-foreground"}>
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs text-destructive space-y-2">
            <p>{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-destructive/35 text-destructive hover:bg-destructive/15"
              onClick={runAnalysis}
              disabled={!selectedModel || !hasKeyForModel || analysisRunning}
            >
              Retry from failed step
            </Button>
          </div>
        )}

        {prerequisitesData && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Prerequisites</h3>
            </div>
            <PrerequisitesSection
              prerequisites={prerequisitesData.prerequisites}
              loadingTopicId={loadingTopicId}
              onLearnMore={handleLearnMore}
            />
          </section>
        )}

        {graphData && (
          <section className="space-y-2 pb-2">
            <h3 className="text-sm font-semibold text-foreground">Related works graph</h3>
            <RelatedWorksGraph graph={graphData} />
          </section>
        )}
      </div>
    </div>
  );
}
