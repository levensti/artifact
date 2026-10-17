"use client";

import {
  getDiscoverQueriesSnapshot,
  getProjectsSnapshot,
  getRecommendationsSnapshot,
  getReviewsSnapshot,
} from "@/lib/client-data";
import { projectMaterial, withProjectContext } from "@/lib/project-research";
import type { SubmitOptions } from "@/hooks/use-discover-chat";

/**
 * Submit options for a research run. `prompt` is what the agent reads (the
 * question, or a built follow-up prompt); `question` is the short form the
 * screening judge grades sources against.
 *
 * In a project, the brief is filed into it, and both the agent and the
 * screen are told what the project already has: the agent's prompt lists it,
 * and the funnel drops those sources before screening. Without a project (or
 * if it's gone), the prompt passes through.
 */
export function researchOptions(
  projectId: string | null,
  prompt: string,
  question: string,
): SubmitOptions {
  const project = projectId
    ? getProjectsSnapshot().find((p) => p.id === projectId)
    : undefined;
  if (!project) {
    return { projectId: null, promptText: prompt, discover: { question } };
  }
  const material = projectMaterial(
    project,
    getReviewsSnapshot(),
    getDiscoverQueriesSnapshot(),
    getRecommendationsSnapshot(),
  );
  const arxivIds = new Set<string>();
  const urls = new Set<string>();
  for (const r of material.reviews) {
    if (r.arxivId) arxivIds.add(r.arxivId);
    else if (r.sourceUrl) urls.add(r.sourceUrl);
  }
  for (const r of material.recommendations) {
    if (r.arxivId) arxivIds.add(r.arxivId);
    else urls.add(r.url);
  }
  return {
    projectId: project.id,
    promptText: withProjectContext(prompt, material),
    discover: {
      question,
      projectName: project.name,
      exclude: { arxivIds: [...arxivIds], urls: [...urls] },
    },
  };
}

/** The question a follow-up is screened against: the follow-up alone is
 *  often too terse ("what about inference?") to judge relevance. */
export function followupQuestion(parentQuestion: string, followup: string): string {
  return `${parentQuestion.trim()} Follow-up: ${followup.trim()}`;
}
