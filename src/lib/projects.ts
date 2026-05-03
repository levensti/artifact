/**
 * Client-side facade over the Projects API. Mirrors the shape of
 * `lib/reviews.ts` — keep the call sites simple and hide the
 * `client-data` cache plumbing behind named imports.
 */

import {
  getProjectsSnapshot,
  refreshProjects,
  createProject as createProjectRemote,
  updateProject as updateProjectRemote,
  deleteProject as deleteProjectRemote,
  addReviewToProject as addReviewToProjectRemote,
  removeReviewFromProject as removeReviewFromProjectRemote,
  setReviewProjects as setReviewProjectsRemote,
  loadReviewProjects,
} from "@/lib/client-data";
import { apiFetch } from "@/lib/client/api";

export { PROJECTS_UPDATED_EVENT } from "@/lib/storage-events";

/// Mirrors the server's `Project` row shape. Re-declared here (instead
/// of imported from `@/server/projects`) so client bundles don't pull
/// in the server-only module.
export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  notes: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  reviewCount: number;
  /// Member review IDs in add-order. Included on the list snapshot
  /// (not just `loadProject`) so the sidebar can render expanded
  /// projects without a per-project fetch.
  reviewIds: string[];
}

/// Historical alias — the list rows now carry `reviewIds`, so the
/// "with reviews" shape is identical to `Project`.
export type ProjectWithReviews = Project;

export function getProjects(): Project[] {
  return getProjectsSnapshot();
}

export function getProject(id: string): Project | undefined {
  return getProjectsSnapshot().find((p) => p.id === id);
}

export {
  refreshProjects,
  createProjectRemote as createProject,
  updateProjectRemote as updateProject,
  deleteProjectRemote as deleteProject,
  addReviewToProjectRemote as addReviewToProject,
  removeReviewFromProjectRemote as removeReviewFromProject,
  setReviewProjectsRemote as setReviewProjects,
  loadReviewProjects,
};

/// Fetch a single project (with the ordered list of member review IDs).
/// Not cached — the list snapshot only carries the lightweight rows.
export async function loadProject(id: string): Promise<ProjectWithReviews | null> {
  try {
    const { project } = await apiFetch<{ project: ProjectWithReviews }>(
      `/api/projects/${encodeURIComponent(id)}`,
    );
    return project;
  } catch (err) {
    if (err instanceof Error && /404|not found/i.test(err.message)) return null;
    throw err;
  }
}

export interface BulkAddResult {
  added: number;
  reused: number;
  failed: { input: string; reason: string }[];
  reviewIds: string[];
}

/// Bulk-add arXiv URLs/IDs to a project. Failures for individual items
/// don't fail the whole call — they come back in `failed` so the UI can
/// show "12 added, 1 didn't parse: <input>".
export async function bulkAddPapers(
  projectId: string,
  items: string[],
): Promise<BulkAddResult> {
  return apiFetch<BulkAddResult>(
    `/api/projects/${encodeURIComponent(projectId)}/bulk-add`,
    { method: "POST", body: { items } },
  );
}
