import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./api";
import { toSlug } from "@/lib/slug";
import type { ChatMessage } from "@/lib/review-types";

/* ── Types ────────────────────────────────────────────────────── */

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
  /// Number of reviews currently attached. Cheap to compute (one
  /// `_count`) and lets the list UI show "12 papers" without a
  /// follow-up round-trip per row.
  reviewCount: number;
  /// Member review IDs in add-order. Included in the lightweight list
  /// snapshot so the sidebar can expand a project inline without a
  /// follow-up fetch. CUIDs are short (~25 chars); even ~100 papers
  /// per project costs <3KB on the wire.
  reviewIds: string[];
}

/// Historical alias from when `reviewIds` lived only on the detail
/// shape. Now part of `Project` itself — kept for API stability.
export type ProjectWithReviews = Project;

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  notes: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

function rowToProject(
  row: ProjectRow,
  reviewCount: number,
  reviewIds: string[],
): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    notes: row.notes,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    reviewCount,
    reviewIds,
  };
}

/* ── List / get ───────────────────────────────────────────────── */

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        orderBy: { addedAt: "asc" },
        select: { reviewId: true },
      },
    },
  });
  return rows.map((r) =>
    rowToProject(
      r,
      r._count.reviews,
      r.reviews.map((m) => m.reviewId),
    ),
  );
}

export async function getProject(
  userId: string,
  id: string,
): Promise<Project | null> {
  const row = await prisma.project.findFirst({
    where: { id, userId },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        orderBy: { addedAt: "asc" },
        select: { reviewId: true },
      },
    },
  });
  if (!row) return null;
  const reviewIds = row.reviews.map((m) => m.reviewId);
  return rowToProject(row, row._count.reviews, reviewIds);
}

/* ── Create / update / delete ─────────────────────────────────── */

const MAX_NAME_LEN = 120;
const MAX_DESCRIPTION_LEN = 500;

/// Walk numeric suffixes until we find an unused slug for this user.
/// Slugs are user-scoped, so collisions are typically rare; the loop
/// terminates after a small number of tries because suffixes ramp.
async function uniqueSlug(userId: string, base: string): Promise<string> {
  const root = base || "project";
  let candidate = root;
  let suffix = 2;
  // Bounded loop — practically returns within a couple of iterations.
  // Cap protects against pathological cases.
  for (let i = 0; i < 50; i++) {
    const hit = await prisma.project.findUnique({
      where: { userId_slug: { userId, slug: candidate } },
      select: { id: true },
    });
    if (!hit) return candidate;
    candidate = `${root}-${suffix++}`;
  }
  // Fall back to a timestamp-based suffix; we are far past the point
  // where a human-readable slug is going to help.
  return `${root}-${Date.now().toString(36)}`;
}

export async function createProject(
  userId: string,
  input: { name: string; description?: string | null; color?: string | null },
): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "Project name is required");
  if (name.length > MAX_NAME_LEN) {
    throw new HttpError(400, `Project name must be ≤ ${MAX_NAME_LEN} characters`);
  }
  const description = (input.description ?? "").trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LEN) {
    throw new HttpError(
      400,
      `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`,
    );
  }
  const slug = await uniqueSlug(userId, toSlug(name));
  const row = await prisma.project.create({
    data: {
      userId,
      name,
      slug,
      description,
      color: input.color ?? null,
    },
  });
  return rowToProject(row, 0, []);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    notes?: string | null;
    color?: string | null;
    archived?: boolean;
  },
): Promise<Project> {
  const existing = await prisma.project.findFirst({
    where: { id, userId },
    select: { id: true, name: true, slug: true },
  });
  if (!existing) throw new HttpError(404, "Project not found");

  const data: {
    name?: string;
    slug?: string;
    description?: string | null;
    notes?: string | null;
    color?: string | null;
    archivedAt?: Date | null;
  } = {};

  if (patch.name !== undefined) {
    const next = patch.name.trim();
    if (!next) throw new HttpError(400, "Project name is required");
    if (next.length > MAX_NAME_LEN) {
      throw new HttpError(400, `Project name must be ≤ ${MAX_NAME_LEN} characters`);
    }
    data.name = next;
    // Only regenerate slug if name actually changed; keeps URLs stable
    // when the user just edits punctuation/case.
    if (next !== existing.name) {
      data.slug = await uniqueSlug(userId, toSlug(next));
    }
  }
  if (patch.description !== undefined) {
    const next = (patch.description ?? "").trim();
    if (next.length > MAX_DESCRIPTION_LEN) {
      throw new HttpError(
        400,
        `Description must be ≤ ${MAX_DESCRIPTION_LEN} characters`,
      );
    }
    data.description = next || null;
  }
  if (patch.notes !== undefined) {
    // Notes are intentionally large (markdown scratchpad). Cap at 50k
    // chars so a runaway paste doesn't blow up the row.
    const next = patch.notes ?? "";
    if (next.length > 50_000) {
      throw new HttpError(400, "Notes too long");
    }
    data.notes = next || null;
  }
  if (patch.color !== undefined) {
    data.color = patch.color || null;
  }
  if (patch.archived !== undefined) {
    data.archivedAt = patch.archived ? new Date() : null;
  }

  const row = await prisma.project.update({
    where: { id },
    data,
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        orderBy: { addedAt: "asc" },
        select: { reviewId: true },
      },
    },
  });
  return rowToProject(
    row,
    row._count.reviews,
    row.reviews.map((m) => m.reviewId),
  );
}

export async function deleteProject(
  userId: string,
  id: string,
): Promise<boolean> {
  const existing = await prisma.project.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.project.delete({ where: { id } });
  return true;
}

/* ── Membership ───────────────────────────────────────────────── */

async function assertOwnership(
  userId: string,
  projectId: string,
  reviewId: string,
): Promise<void> {
  const [project, review] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    }),
    prisma.review.findFirst({
      where: { id: reviewId, userId },
      select: { id: true },
    }),
  ]);
  if (!project) throw new HttpError(404, "Project not found");
  if (!review) throw new HttpError(404, "Review not found");
}

/// Add a review to a project. Idempotent: re-adding an existing
/// member is a no-op (returns false), so the UI can fire "add" without
/// checking membership first. Touches `updatedAt` on a fresh add so the
/// project bubbles up in the list.
export async function addReviewToProject(
  userId: string,
  projectId: string,
  reviewId: string,
): Promise<boolean> {
  await assertOwnership(userId, projectId, reviewId);
  try {
    await prisma.projectReview.create({
      data: { projectId, reviewId },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
    return true;
  } catch (err) {
    // Unique-constraint violation means the membership already exists.
    // Any other error propagates.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return false;
    }
    throw err;
  }
}

export async function removeReviewFromProject(
  userId: string,
  projectId: string,
  reviewId: string,
): Promise<boolean> {
  await assertOwnership(userId, projectId, reviewId);
  const result = await prisma.projectReview.deleteMany({
    where: { projectId, reviewId },
  });
  if (result.count > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  }
  return result.count > 0;
}

/// Replace a review's full set of project memberships. Used by the
/// "Manage projects…" dialog where the user toggles checkboxes and
/// hits Save. One transaction keeps it atomic.
export async function setReviewProjects(
  userId: string,
  reviewId: string,
  projectIds: string[],
): Promise<void> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!review) throw new HttpError(404, "Review not found");

  const desired = Array.from(new Set(projectIds));
  if (desired.length > 0) {
    const owned = await prisma.project.count({
      where: { userId, id: { in: desired } },
    });
    if (owned !== desired.length) {
      throw new HttpError(404, "One or more projects not found");
    }
  }

  await prisma.$transaction([
    prisma.projectReview.deleteMany({ where: { reviewId } }),
    ...(desired.length > 0
      ? [
          prisma.projectReview.createMany({
            data: desired.map((projectId) => ({ projectId, reviewId })),
          }),
        ]
      : []),
    ...(desired.length > 0
      ? [
          prisma.project.updateMany({
            where: { id: { in: desired } },
            data: { updatedAt: new Date() },
          }),
        ]
      : []),
  ]);
}

/// For a single review, return the list of project IDs it belongs to.
/// Powers the "in: A, B" chip on the review page and the initial
/// state of the manage-projects dialog.
export async function getReviewProjects(
  userId: string,
  reviewId: string,
): Promise<string[]> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!review) throw new HttpError(404, "Review not found");
  const rows = await prisma.projectReview.findMany({
    where: { reviewId, project: { userId } },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/* ── Chat messages ────────────────────────────────────────────── */

async function assertProjectOwned(
  userId: string,
  projectId: string,
): Promise<void> {
  const exists = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!exists) throw new HttpError(404, `Project not found: ${projectId}`);
}

export async function getProjectMessages(
  userId: string,
  projectId: string,
): Promise<ChatMessage[]> {
  await assertProjectOwned(userId, projectId);
  const row = await prisma.projectMessages.findUnique({
    where: { projectId },
  });
  return (row?.messages as unknown as ChatMessage[] | undefined) ?? [];
}

export async function setProjectMessages(
  userId: string,
  projectId: string,
  messages: ChatMessage[],
): Promise<void> {
  await assertProjectOwned(userId, projectId);
  await prisma.projectMessages.upsert({
    where: { projectId },
    create: {
      projectId,
      messages: messages as unknown as Prisma.InputJsonValue,
    },
    update: {
      messages: messages as unknown as Prisma.InputJsonValue,
    },
  });
}

/* ── Bulk membership add ──────────────────────────────────────── */

/// Attach many existing reviews to a project in one transaction. Used
/// by the bulk-add flow once the reviews are created. Returns the
/// number of new memberships actually created (skipping ones that
/// already exist).
export async function addReviewsToProject(
  userId: string,
  projectId: string,
  reviewIds: string[],
): Promise<number> {
  if (reviewIds.length === 0) return 0;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "Project not found");

  // Filter to reviews owned by this user — we don't want a malicious
  // payload to attach someone else's review row by ID guess.
  const owned = await prisma.review.findMany({
    where: { userId, id: { in: reviewIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((r) => r.id));
  const data = reviewIds
    .filter((id) => ownedIds.has(id))
    .map((reviewId) => ({ projectId, reviewId }));
  if (data.length === 0) return 0;

  // skipDuplicates: idempotent re-run of an in-progress bulk add is a
  // no-op for existing rows rather than an error.
  const result = await prisma.projectReview.createMany({
    data,
    skipDuplicates: true,
  });
  if (result.count > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  }
  return result.count;
}
