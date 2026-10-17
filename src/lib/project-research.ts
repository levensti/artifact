/**
 * Project context for research started inside a project. The agent is told
 * what the project already covers (papers being read, papers already
 * suggested, earlier questions) so it builds on that instead of repeating it.
 */

import { normalizeArxivId } from "@/lib/arxiv";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import type { PaperReview, Project } from "@/lib/review-types";

/** Enough to steer the agent without bloating the prompt. */
const MAX_PAPERS = 40;
const MAX_QUESTIONS = 8;

export interface ProjectMaterial {
  project: Project;
  /** Reviews filed in the project. */
  reviews: PaperReview[];
  /** Briefs linked to the project. */
  queries: DiscoverQuery[];
  /** Recommendations from those briefs (dismissed ones included: the user
   *  has seen and rejected them, so they shouldn't come back either). */
  recommendations: Recommendation[];
}

/** Collects a project's material from the client caches. */
export function projectMaterial(
  project: Project,
  reviews: PaperReview[],
  queries: DiscoverQuery[],
  recommendations: Recommendation[],
): ProjectMaterial {
  const linked = queries.filter((q) => q.projectId === project.id);
  const ids = new Set(linked.map((q) => q.id));
  return {
    project,
    reviews: reviews.filter((r) => r.projectId === project.id),
    queries: linked,
    recommendations: recommendations.filter((r) => ids.has(r.queryId)),
  };
}

function paperKey(arxivId: string | null, url: string | null): string {
  if (arxivId) return `arxiv:${normalizeArxivId(arxivId)}`;
  return `url:${url ?? ""}`;
}

function paperLine(title: string, arxivId: string | null, url: string | null) {
  if (arxivId) return `- ${title} (arXiv:${normalizeArxivId(arxivId)})`;
  return url ? `- ${title} (${url})` : `- ${title}`;
}

/** The context block prepended to a research prompt run in a project. */
export function buildProjectContext(m: ProjectMaterial): string {
  const seen = new Set<string>();
  const papers: string[] = [];
  const add = (title: string, arxivId: string | null, url: string | null) => {
    const key = paperKey(arxivId, url);
    if (seen.has(key)) return;
    seen.add(key);
    papers.push(paperLine(title, arxivId, url));
  };
  for (const r of m.reviews) add(r.title, r.arxivId, r.sourceUrl ?? null);
  for (const r of [...m.recommendations].sort((a, b) => a.rank - b.rank)) {
    add(r.title, r.arxivId, r.url);
  }

  const questions = [...m.queries]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, MAX_QUESTIONS)
    .map((q) => `- ${q.query}`);

  const lines = [
    `This research is for the user's project "${m.project.name}".`,
  ];
  if (questions.length > 0) {
    lines.push("", "Questions already researched in this project:", ...questions);
  }
  if (papers.length > 0) {
    const shown = papers.slice(0, MAX_PAPERS);
    lines.push(
      "",
      "The project already has these sources (being read or already suggested). Do NOT recommend any of them again. Find new material that complements them:",
      ...shown,
    );
    if (papers.length > shown.length) {
      lines.push(`- …and ${papers.length - shown.length} more already in the project`);
    }
  }
  return lines.join("\n");
}

/** A research prompt with the project's context in front of it. `prompt` is
 *  the question, or an already-built follow-up prompt. */
export function withProjectContext(prompt: string, m: ProjectMaterial): string {
  return `${buildProjectContext(m)}\n\n${prompt.trim()}`;
}
