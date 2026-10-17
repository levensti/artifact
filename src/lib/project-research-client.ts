"use client";

import {
  getDiscoverQueriesSnapshot,
  getProjectsSnapshot,
  getRecommendationsSnapshot,
  getReviewsSnapshot,
} from "@/lib/client-data";
import { projectMaterial, withProjectContext } from "@/lib/project-research";

/**
 * Submit options for research that belongs to a project: the brief is filed
 * into the project, and the agent is told what the project already has so it
 * doesn't suggest it again. `prompt` is the question or a built follow-up
 * prompt. Without a project (or if it's gone), the prompt passes through.
 */
export function projectResearchOptions(
  projectId: string | null,
  prompt: string,
): { projectId: string | null; promptText?: string } {
  const project = projectId
    ? getProjectsSnapshot().find((p) => p.id === projectId)
    : undefined;
  if (!project) return { projectId: null, promptText: prompt };
  const material = projectMaterial(
    project,
    getReviewsSnapshot(),
    getDiscoverQueriesSnapshot(),
    getRecommendationsSnapshot(),
  );
  return {
    projectId: project.id,
    promptText: withProjectContext(prompt, material),
  };
}
