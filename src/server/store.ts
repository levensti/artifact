import "server-only";
import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import type { Annotation } from "@/lib/annotations";
import type { ArtifactContent, ReviewArtifact } from "@/lib/artifacts";
import type {
  ChatMessage,
  ContextMetadata,
  PaperReview,
  Project,
} from "@/lib/review-types";
import type {
  DiscoverQuery,
  DiscoverQueryStatus,
  Recommendation,
} from "@/lib/discover-types";
import { normalizeArxivId } from "@/lib/arxiv";
import { arxivIdFromUrl, type ParsedPick } from "@/lib/picks-parser";
import { HttpError } from "./api";
import { sendSlackEvent, SlackEventType } from "./notifications";
import { judgeAvailable, judgePicks } from "./judge";
import { orderByJudge, type JudgeDetail } from "@/lib/judge-rubric";

/* ── Reviews ──────────────────────────────────────────────────── */

export async function listReviews(userId: string): Promise<PaperReview[]> {
  // Most recently active first: `updatedAt` is bumped on every chat and note
  // write (see `touchReviewOp`), so it tracks the user's last interaction.
  const rows = await prisma.review.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(rowToReview);
}

export async function getReview(
  userId: string,
  id: string,
): Promise<PaperReview | null> {
  const row = await prisma.review.findFirst({ where: { id, userId } });
  return row ? rowToReview(row) : null;
}

export async function getReviewByArxivId(
  userId: string,
  arxivId: string,
): Promise<PaperReview | null> {
  const target = normalizeArxivId(arxivId);
  // Match against all the user's reviews, normalizing both sides.
  const rows = await prisma.review.findMany({
    where: { userId, arxivId: { not: null } },
  });
  const hit = rows.find(
    (r) => r.arxivId && normalizeArxivId(r.arxivId) === target,
  );
  return hit ? rowToReview(hit) : null;
}

export async function getReviewBySourceUrl(
  userId: string,
  sourceUrl: string,
): Promise<PaperReview | null> {
  const row = await prisma.review.findFirst({
    where: { userId, sourceUrl },
  });
  return row ? rowToReview(row) : null;
}

export async function insertReview(
  userId: string,
  review: PaperReview,
  /**
   * When the review is being created from a Discover recommendation, pass
   * the rec id so the FK is set atomically. Stays null for paste-link, PDF
   * upload, web review, and import flows.
   */
  fromRecommendationId?: string | null,
  projectId?: string | null,
): Promise<PaperReview> {
  const row = await prisma.review.create({
    data: {
      id: review.id,
      userId,
      title: review.title,
      arxivId: review.arxivId,
      pdfPath: review.pdfPath,
      sourceUrl: review.sourceUrl,
      createdAt: new Date(review.createdAt),
      updatedAt: new Date(review.updatedAt),
      importedAt: review.importedAt ? new Date(review.importedAt) : null,
      fromRecommendationId: fromRecommendationId ?? null,
      projectId: projectId ?? null,
    },
  });
  if (!review.importedAt) {
    await sendSlackEvent(
      SlackEventType.ReviewInitiated,
      `started review: ${review.title} (${review.id})`,
      userId,
    );
  }
  return rowToReview(row);
}

/**
 * Rename a review. Bumps updatedAt. Returns the updated review or null when
 * the row isn't owned by this user or doesn't exist.
 */
export async function updateReviewTitle(
  userId: string,
  reviewId: string,
  title: string,
): Promise<PaperReview | null> {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!existing) return null;
  const row = await prisma.review.update({
    where: { id: reviewId },
    data: { title, updatedAt: new Date() },
  });
  return rowToReview(row);
}

/** Delete a review and the PDF blob it owns. Cascades take care of the rest. */
export async function deleteReview(
  userId: string,
  id: string,
): Promise<{ pdfPath: string | null } | null> {
  const existing = await prisma.review.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await prisma.review.delete({ where: { id } });
  return { pdfPath: existing.pdfPath };
}

function rowToReview(r: {
  id: string;
  title: string;
  arxivId: string | null;
  pdfPath: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  importedAt: Date | null;
  importedFromShareToken?: string | null;
  importedFromName?: string | null;
  projectId?: string | null;
  documentId?: string | null;
}): PaperReview {
  return {
    id: r.id,
    title: r.title,
    arxivId: r.arxivId,
    pdfPath: r.pdfPath,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    projectId: r.projectId ?? null,
    documentId: r.documentId ?? null,
    ...(r.importedAt ? { importedAt: r.importedAt.toISOString() } : {}),
    ...(r.importedFromShareToken
      ? { importedFromShareToken: r.importedFromShareToken }
      : {}),
    ...(r.importedFromName ? { importedFromName: r.importedFromName } : {}),
  };
}

/* ── Messages / annotations ──────────────────────────────────── */

/** Bump a review's `updatedAt` to now. Chat and note writes run this in the
 *  same transaction so the library's recency order reflects the last
 *  interaction, not creation time. */
function touchReviewOp(reviewId: string) {
  return prisma.review.update({
    where: { id: reviewId },
    data: { updatedAt: new Date() },
  });
}

async function assertReviewOwned(userId: string, reviewId: string): Promise<void> {
  const exists = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!exists) throw new HttpError(404, `Review not found: ${reviewId}`);
}

export async function getMessages(
  userId: string,
  reviewId: string,
): Promise<ChatMessage[]> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewMessages.findUnique({ where: { reviewId } });
  return (row?.messages as unknown as ChatMessage[] | undefined) ?? [];
}

/**
 * Load a conversation's messages plus its `contextMetadata` (compaction record
 * + last measured context size) in one read. Use this on paths that need the
 * context state — the usage meter, compaction-aware transcript build, and the
 * compaction endpoint.
 */
export async function getConversation(
  userId: string,
  reviewId: string,
): Promise<{ messages: ChatMessage[]; contextMetadata: ContextMetadata | null }> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewMessages.findUnique({ where: { reviewId } });
  return {
    messages: (row?.messages as unknown as ChatMessage[] | undefined) ?? [],
    contextMetadata:
      (row?.contextMetadata as unknown as ContextMetadata | null | undefined) ??
      null,
  };
}

/**
 * Update only the `contextMetadata` column, leaving `messages` untouched.
 * Used by the compaction endpoint, which records a recap without mutating the
 * raw history. No-ops with a 404 if the conversation row doesn't exist yet
 * (nothing to compact).
 */
export async function setContextMetadata(
  userId: string,
  reviewId: string,
  contextMetadata: ContextMetadata,
): Promise<void> {
  await assertReviewOwned(userId, reviewId);
  await prisma.reviewMessages.update({
    where: { reviewId },
    data: {
      contextMetadata: contextMetadata as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function setMessages(
  userId: string,
  reviewId: string,
  messages: ChatMessage[],
  contextMetadata?: ContextMetadata,
): Promise<void> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, title: true },
  });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  const prior = await prisma.reviewMessages.findUnique({
    where: { reviewId },
    select: { messages: true },
  });
  const priorMsgs =
    (prior?.messages as unknown as ChatMessage[] | undefined) ?? [];
  // Only touch the metadata column when the caller supplies it, so callers
  // that just persist messages don't clobber an existing compaction record.
  const metaData =
    contextMetadata !== undefined
      ? { contextMetadata: contextMetadata as unknown as Prisma.InputJsonValue }
      : {};
  await prisma.$transaction([
    prisma.reviewMessages.upsert({
      where: { reviewId },
      create: {
        reviewId,
        messages: messages as unknown as Prisma.InputJsonValue,
        ...metaData,
      },
      update: {
        messages: messages as unknown as Prisma.InputJsonValue,
        ...metaData,
      },
    }),
    touchReviewOp(reviewId),
  ]);
  // Fire when a new user-authored message has appeared in this save.
  // Persistence happens after streaming, so by the time we see it the
  // assistant reply is usually the tail; we still want to count the user
  // turn that triggered it.
  const priorIds = new Set(priorMsgs.map((m) => m.id));
  const addedUser = messages.find(
    (m) => m.role === "user" && !priorIds.has(m.id),
  );
  if (addedUser) {
    await sendSlackEvent(
      SlackEventType.ReviewMessageSent,
      `sent message in "${review.title}" (${reviewId})`,
      userId,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Artifacts                                                          */
/* ------------------------------------------------------------------ */

const VERSION_META = { number: true, changeSummary: true, createdAt: true } as const;

/** A review's artifacts, most recently changed first, each with its current
 *  source and its version history. */
export async function listArtifacts(
  userId: string,
  reviewId: string,
): Promise<ReviewArtifact[]> {
  await assertReviewOwned(userId, reviewId);
  const rows = await prisma.reviewArtifact.findMany({
    where: { reviewId },
    orderBy: { updatedAt: "desc" },
    include: { versions: { select: VERSION_META, orderBy: { number: "desc" } } },
  });
  if (rows.length === 0) return [];
  // Only the current version's source; older ones load on demand.
  const latest = await prisma.artifactVersion.findMany({
    where: { artifactId: { in: rows.map((r) => r.id) } },
    orderBy: [{ artifactId: "asc" }, { number: "desc" }],
    distinct: ["artifactId"],
    select: { artifactId: true, html: true },
  });
  const htmlById = new Map(latest.map((v) => [v.artifactId, v.html]));
  return rows.map((row) => ({
    id: row.id,
    reviewId: row.reviewId,
    title: row.title,
    summary: row.summary,
    html: htmlById.get(row.id) ?? "",
    sourceCallId: row.sourceCallId,
    version: row.versions[0]?.number ?? 1,
    versions: row.versions.map((v) => ({
      ...v,
      createdAt: v.createdAt.toISOString(),
    })),
    state: row.state ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function assertArtifactOwned(
  userId: string,
  reviewId: string,
  artifactId: string,
) {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewArtifact.findFirst({
    where: { id: artifactId, reviewId },
  });
  if (!row) throw new HttpError(404, "Artifact not found");
  return row;
}

async function latestVersion(artifactId: string) {
  const v = await prisma.artifactVersion.findFirst({
    where: { artifactId },
    orderBy: { number: "desc" },
  });
  if (!v) throw new HttpError(404, "Artifact has no versions");
  return v;
}

/** One version's source. */
export async function getArtifactVersion(
  userId: string,
  reviewId: string,
  artifactId: string,
  number: number,
): Promise<{ number: number; html: string; changeSummary: string }> {
  await assertArtifactOwned(userId, reviewId, artifactId);
  const v = await prisma.artifactVersion.findUnique({
    where: { artifactId_number: { artifactId, number } },
  });
  if (!v) throw new HttpError(404, "Version not found");
  return { number: v.number, html: v.html, changeSummary: v.changeSummary };
}

/** An artifact's current title, summary, source, and reader state, for the
 *  model (the open artifact is put in its context each turn). */
export async function getArtifactCurrent(
  userId: string,
  reviewId: string,
  artifactId: string,
): Promise<ArtifactContent & { id: string; version: number; state: unknown }> {
  const row = await assertArtifactOwned(userId, reviewId, artifactId);
  const v = await latestVersion(artifactId);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    html: v.html,
    version: v.number,
    state: row.state ?? null,
  };
}

/** Save a new artifact as version 1. `sourceCallId` dedupes a retried call:
 *  the existing artifact comes back instead of a second copy. */
export async function createArtifact(
  userId: string,
  reviewId: string,
  content: ArtifactContent,
  sourceCallId: string | null,
): Promise<{ id: string; version: number }> {
  await assertReviewOwned(userId, reviewId);
  if (sourceCallId) {
    const existing = await prisma.reviewArtifact.findUnique({
      where: { reviewId_sourceCallId: { reviewId, sourceCallId } },
    });
    if (existing) return { id: existing.id, version: 1 };
  }
  const row = await prisma.reviewArtifact.create({
    data: {
      reviewId,
      title: content.title,
      summary: content.summary,
      sourceCallId,
      versions: {
        create: {
          number: 1,
          html: content.html,
          changeSummary: "Created",
          sourceCallId,
        },
      },
    },
  });
  return { id: row.id, version: 1 };
}

/**
 * Append a version. `html` is the new source (already edited and linted by
 * the caller, from the current version it read). Title and summary change
 * only when given. A retried tool call (same `sourceCallId`) returns the
 * version it already wrote.
 */
export async function appendArtifactVersion(
  userId: string,
  reviewId: string,
  artifactId: string,
  change: {
    html: string;
    changeSummary: string;
    sourceCallId?: string | null;
    title?: string;
    summary?: string;
  },
): Promise<{ version: number }> {
  await assertArtifactOwned(userId, reviewId, artifactId);
  if (change.sourceCallId) {
    const dup = await prisma.artifactVersion.findFirst({
      where: { artifactId, sourceCallId: change.sourceCallId },
    });
    if (dup) return { version: dup.number };
  }
  // Two writers racing for the same number lose on the unique index; retry
  // once on the fresh latest.
  for (let attempt = 0; ; attempt++) {
    const latest = await latestVersion(artifactId);
    try {
      await prisma.$transaction([
        prisma.artifactVersion.create({
          data: {
            artifactId,
            number: latest.number + 1,
            html: change.html,
            changeSummary: change.changeSummary.slice(0, 200),
            sourceCallId: change.sourceCallId ?? null,
          },
        }),
        prisma.reviewArtifact.update({
          where: { id: artifactId },
          data: {
            updatedAt: new Date(),
            ...(change.title ? { title: change.title.slice(0, 120) } : {}),
            ...(change.summary ? { summary: change.summary.slice(0, 400) } : {}),
          },
        }),
      ]);
      return { version: latest.number + 1 };
    } catch (e) {
      const conflict =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!conflict || attempt > 0) throw e;
    }
  }
}

/** Restore an older version by appending a copy of it (nothing is lost). */
export async function restoreArtifactVersion(
  userId: string,
  reviewId: string,
  artifactId: string,
  number: number,
  changeSummary = `Restored v${number}`,
): Promise<{ version: number }> {
  const old = await getArtifactVersion(userId, reviewId, artifactId, number);
  return appendArtifactVersion(userId, reviewId, artifactId, {
    html: old.html,
    changeSummary,
  });
}

/**
 * "Keep it as a separate artifact": move version `number` (the current one,
 * an edit the model made in place) into a new artifact, and put the original
 * back to the version before it.
 */
export async function splitArtifactVersion(
  userId: string,
  reviewId: string,
  artifactId: string,
  number: number,
): Promise<{ id: string }> {
  const row = await assertArtifactOwned(userId, reviewId, artifactId);
  const latest = await latestVersion(artifactId);
  if (latest.number !== number || number < 2) {
    throw new HttpError(409, "Only the latest edit can be moved out");
  }
  const created = await createArtifact(
    userId,
    reviewId,
    { title: row.title, summary: row.summary, html: latest.html },
    null,
  );
  await restoreArtifactVersion(
    userId,
    reviewId,
    artifactId,
    number - 1,
    `Moved v${number} to a separate artifact`,
  );
  return created;
}

/** Largest reader state the bridge may save, serialized. */
const MAX_ARTIFACT_STATE_BYTES = 32_000;

/** Save what the reader did inside the page (quiz answers, slider values). */
export async function setArtifactState(
  userId: string,
  reviewId: string,
  artifactId: string,
  state: unknown,
): Promise<void> {
  const size = JSON.stringify(state ?? null).length;
  if (size > MAX_ARTIFACT_STATE_BYTES) {
    throw new HttpError(413, "Artifact state is too large");
  }
  await assertArtifactOwned(userId, reviewId, artifactId);
  await prisma.reviewArtifact.update({
    where: { id: artifactId },
    // Not an edit: keep the list order (updatedAt) where it was.
    data: {
      state:
        state === null
          ? Prisma.DbNull
          : (state as unknown as Prisma.InputJsonValue),
    },
  });
}

export async function getAnnotations(
  userId: string,
  reviewId: string,
): Promise<Annotation[]> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewAnnotations.findUnique({ where: { reviewId } });
  return (row?.annotations as unknown as Annotation[] | undefined) ?? [];
}

export async function setAnnotations(
  userId: string,
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, title: true },
  });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  const prior = await prisma.reviewAnnotations.findUnique({
    where: { reviewId },
    select: { annotations: true },
  });
  const priorAnns =
    (prior?.annotations as unknown as Annotation[] | undefined) ?? [];
  await prisma.$transaction([
    prisma.reviewAnnotations.upsert({
      where: { reviewId },
      create: {
        reviewId,
        annotations: annotations as unknown as Prisma.InputJsonValue,
      },
      update: {
        annotations: annotations as unknown as Prisma.InputJsonValue,
      },
    }),
    touchReviewOp(reviewId),
  ]);
  const priorIds = new Set(priorAnns.map((a) => a.id));
  const added = annotations.filter((a) => !priorIds.has(a.id));
  for (const a of added) {
    if (a.kind === "ask_ai") {
      // "Dive deeper" / ask-AI from a selection is conversational, not a note.
      await sendSlackEvent(
        SlackEventType.ReviewMessageSent,
        `dove deeper on "${review.title}" (p.${a.pageNumber})`,
        userId,
      );
    } else {
      await sendSlackEvent(
        SlackEventType.NoteAdded,
        `added note on "${review.title}" (p.${a.pageNumber})`,
        userId,
      );
    }
  }
}

/* ── Settings ─────────────────────────────────────────────────── */

import { decrypt, encrypt } from "./crypto";

/** Pseudo-provider identifying the Exa Search tool key in the ApiKey table. */
const EXA_PROVIDER = "exa";
/** Provider slug for the user's optional Fireworks key override. */
const FIREWORKS_PROVIDER = "fireworks";

export interface SettingsSnapshot {
  /** User's optional Fireworks key override (server falls back to env). */
  fireworksKey: string | null;
  exaApiKey: string | null;
}

export async function getSettings(userId: string): Promise<SettingsSnapshot> {
  const apiKeys = await prisma.apiKey.findMany({ where: { userId } });

  let fireworksKey: string | null = null;
  let exaApiKey: string | null = null;
  for (const row of apiKeys) {
    if (row.provider === FIREWORKS_PROVIDER) {
      fireworksKey = decrypt(row.value);
    } else if (row.provider === EXA_PROVIDER) {
      exaApiKey = decrypt(row.value);
    }
    // Any other rows (legacy per-provider keys: anthropic/openai/xai/brave)
    // are ignored — the app now uses a single Fireworks key.
  }

  return { fireworksKey, exaApiKey };
}

export interface SettingsPatch {
  fireworksKey?: string | null;
  exaApiKey?: string | null;
}

export async function patchSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const upsertKey = (provider: string, value: string) =>
      tx.apiKey.upsert({
        where: { userId_provider: { userId, provider } },
        create: { userId, provider, value: encrypt(value) },
        update: { value: encrypt(value) },
      });
    const deleteKey = (provider: string) =>
      tx.apiKey.deleteMany({ where: { userId, provider } });

    const applyKey = async (provider: string, v: string | null | undefined) => {
      if (v === null || v === undefined || v === "") {
        await deleteKey(provider);
      } else {
        await upsertKey(provider, v);
      }
    };

    if ("fireworksKey" in patch) {
      await applyKey(FIREWORKS_PROVIDER, patch.fireworksKey);
    }
    if ("exaApiKey" in patch) {
      await applyKey(EXA_PROVIDER, patch.exaApiKey);
    }
  });
}

/* ── PDF blobs ───────────────────────────────────────────────── */

export interface PdfBlobMeta {
  id: string;
  storagePath: string;
  name: string | null;
}

export async function recordPdfBlob(
  userId: string,
  id: string,
  storagePath: string,
  name: string | null,
): Promise<void> {
  await prisma.pdfBlob.create({
    data: { id, userId, storagePath, name, createdAt: new Date() },
  });
}

export async function getPdfBlob(
  userId: string,
  id: string,
): Promise<PdfBlobMeta | null> {
  const row = await prisma.pdfBlob.findFirst({ where: { id, userId } });
  return row
    ? { id: row.id, storagePath: row.storagePath, name: row.name }
    : null;
}

export async function deletePdfBlobRecord(
  userId: string,
  id: string,
): Promise<string | null> {
  const row = await prisma.pdfBlob.findFirst({ where: { id, userId } });
  if (!row) return null;
  await prisma.pdfBlob.delete({ where: { id } });
  return row.storagePath;
}

/* ── Discover queries + recommendations ───────────────────────── */

interface DiscoverQueryRow {
  id: string;
  query: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  projectId: string | null;
}

interface RecommendationRow {
  id: string;
  queryId: string;
  rank: number;
  url: string;
  title: string;
  rationale: string;
  arxivId: string | null;
  authors: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  venue: string | null;
  citationCount: number | null;
  judgeScore: number | null;
  judgeDetail: unknown;
  dismissedAt: Date | null;
  createdAt: Date;
}

function rowToDiscoverQuery(r: DiscoverQueryRow): DiscoverQuery {
  return {
    id: r.id,
    query: r.query,
    notes: r.notes,
    status: r.status as DiscoverQueryStatus,
    createdAt: r.createdAt.toISOString(),
    projectId: r.projectId,
  };
}

function rowToRecommendation(r: RecommendationRow): Recommendation {
  return {
    id: r.id,
    queryId: r.queryId,
    rank: r.rank,
    url: r.url,
    title: r.title,
    rationale: r.rationale,
    arxivId: r.arxivId,
    authors: r.authors,
    publishedDate: r.publishedDate,
    publishedYear: r.publishedYear,
    venue: r.venue,
    citationCount: r.citationCount,
    judgeScore: r.judgeScore,
    judgeDetail: (r.judgeDetail as JudgeDetail | null) ?? null,
    dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function assertDiscoverQueryOwned(
  userId: string,
  queryId: string,
): Promise<void> {
  const exists = await prisma.discoverQuery.findFirst({
    where: { id: queryId, userId },
    select: { id: true },
  });
  if (!exists)
    throw new HttpError(404, `Discover query not found: ${queryId}`);
}

async function assertRecommendationOwned(
  userId: string,
  recId: string,
): Promise<void> {
  const exists = await prisma.recommendation.findFirst({
    where: { id: recId, query: { userId } },
    select: { id: true },
  });
  if (!exists)
    throw new HttpError(404, `Recommendation not found: ${recId}`);
}

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

export async function createDiscoverQuery(
  userId: string,
  query: string,
  projectId: string | null = null,
): Promise<DiscoverQuery> {
  if (projectId) await assertProjectOwned(userId, projectId);
  const row = await prisma.discoverQuery.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      query,
      status: "running",
      createdAt: new Date(),
      projectId,
    },
  });
  await sendSlackEvent(
    SlackEventType.DiscoveryInitiated,
    `started discovery: ${query}`,
    userId,
  );
  return rowToDiscoverQuery(row);
}

/**
 * Finalize a discover query: persist the agent's auxiliary notes, mark
 * status, and write Recommendation rows for the parsed picks. Idempotent
 * on re-call only in the sense that it overwrites notes/status; existing
 * recommendation rows are NOT cleared (callers should only finalize once
 * per query).
 */
export async function finalizeDiscoverQuery(
  userId: string,
  queryId: string,
  payload: {
    notes: string | null;
    picks: ParsedPick[];
    status: Exclude<DiscoverQueryStatus, "running">;
  },
): Promise<{ query: DiscoverQuery; recommendations: Recommendation[] }> {
  await assertDiscoverQueryOwned(userId, queryId);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.discoverQuery.update({
      where: { id: queryId },
      data: { notes: payload.notes, status: payload.status },
    });
    const created: RecommendationRow[] = [];
    for (let i = 0; i < payload.picks.length; i++) {
      const pick = payload.picks[i];
      const row = await tx.recommendation.create({
        data: {
          id: crypto.randomUUID(),
          queryId,
          // 1-indexed: the agent's preference order, surfaced in the queue.
          rank: i + 1,
          url: pick.url,
          title: pick.title,
          rationale: pick.rationale,
          // Prefer the agent-provided arxiv id (from submit_picks); fall
          // back to URL extraction for the markdown-parser path.
          arxivId: pick.arxivId ?? arxivIdFromUrl(pick.url),
          authors: pick.authors ?? null,
          publishedDate: pick.publishedDate ?? null,
          publishedYear: pick.publishedYear ?? null,
          venue: pick.venue ?? null,
          citationCount: pick.citationCount ?? null,
          // Screened by the funnel: keep its content-based score. Picks
          // without one are judged below.
          judgeScore: pick.judgeScore ?? null,
          ...(pick.judgeDetail
            ? { judgeDetail: pick.judgeDetail as Prisma.InputJsonValue }
            : {}),
          createdAt: now,
        },
      });
      created.push(row);
    }
    return { query: updated, recs: created };
  });

  // Score the picks and reorder them by the judge. Best-effort: without a
  // key, or if judging fails, the agent's order stands.
  const recommendations =
    result.recs.length > 0
      ? await judgeQueryRecommendations(queryId)
      : [];

  return {
    query: rowToDiscoverQuery(result.query),
    recommendations:
      recommendations.length > 0
        ? recommendations
        : result.recs.map(rowToRecommendation),
  };
}

/**
 * Judge a brief's unscored picks and, once every pick has a score, renumber
 * `rank` in the judge's order. The judge sees the brief's question and its
 * project's name, so scores are comparable across a project's briefs.
 * Returns the brief's recommendations (empty when judging is unavailable).
 * Never throws: judging only ever improves on the agent's order.
 */
async function judgeQueryRecommendations(
  queryId: string,
): Promise<Recommendation[]> {
  if (!judgeAvailable()) return [];
  try {
    const query = await prisma.discoverQuery.findUnique({
      where: { id: queryId },
      select: { query: true, project: { select: { name: true } } },
    });
    if (!query) return [];
    const recs = await prisma.recommendation.findMany({
      where: { queryId },
      orderBy: { rank: "asc" },
    });
    const unscored = recs.filter((r) => r.judgeScore === null);
    if (unscored.length > 0) {
      const results = await judgePicks(
        { question: query.query, projectName: query.project?.name ?? null },
        unscored.map((r) => ({
          title: r.title,
          url: r.url,
          rationale: r.rationale,
          arxivId: r.arxivId,
          authors: r.authors,
          publishedYear: r.publishedYear,
          venue: r.venue,
        })),
      );
      await Promise.all(
        unscored.map((r, i) => {
          const result = results[i];
          if (!result) return null;
          r.judgeScore = result.score;
          r.judgeDetail = result.detail as unknown as Prisma.JsonValue;
          return prisma.recommendation.update({
            where: { id: r.id },
            data: {
              judgeScore: result.score,
              judgeDetail: result.detail as unknown as Prisma.InputJsonValue,
            },
          });
        }),
      );
    }

    // Renumber only when every pick is scored; a partial result would push
    // the unscored ones to the bottom for no reason.
    if (recs.every((r) => r.judgeScore !== null)) {
      const ordered = orderByJudge(recs, (r) => r.judgeScore);
      const changed = ordered.filter((r, i) => r.rank !== i + 1);
      if (changed.length > 0) {
        await prisma.$transaction(
          ordered.map((r, i) =>
            prisma.recommendation.update({
              where: { id: r.id },
              data: { rank: i + 1 },
            }),
          ),
        );
        ordered.forEach((r, i) => (r.rank = i + 1));
      }
      return ordered.map(rowToRecommendation);
    }
    return recs.map(rowToRecommendation);
  } catch (err) {
    console.error("Judging recommendations failed", {
      queryId,
      error: err instanceof Error ? err.message : err,
    });
    return [];
  }
}

/**
 * Judge the unscored picks of some of the user's briefs (picks saved before
 * the judge existed, or whose judging failed). Returns the briefs' updated
 * recommendations; `available` is false when no judge is configured.
 */
export async function judgeBriefs(
  userId: string,
  queryIds: string[],
): Promise<{ available: boolean; recommendations: Recommendation[] }> {
  if (!judgeAvailable()) return { available: false, recommendations: [] };
  const owned = await prisma.discoverQuery.findMany({
    where: { id: { in: queryIds }, userId },
    select: { id: true },
  });
  const updated: Recommendation[] = [];
  for (const q of owned) {
    updated.push(...(await judgeQueryRecommendations(q.id)));
  }
  return { available: true, recommendations: updated };
}

export async function listDiscoverQueries(
  userId: string,
): Promise<DiscoverQuery[]> {
  const rows = await prisma.discoverQuery.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToDiscoverQuery);
}

export async function listRecommendations(
  userId: string,
): Promise<Recommendation[]> {
  const rows = await prisma.recommendation.findMany({
    where: { query: { userId } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToRecommendation);
}

export async function getRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation | null> {
  const row = await prisma.recommendation.findFirst({
    where: { id: recId, query: { userId } },
  });
  return row ? rowToRecommendation(row) : null;
}

export async function dismissRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation> {
  await assertRecommendationOwned(userId, recId);
  const row = await prisma.recommendation.update({
    where: { id: recId },
    data: { dismissedAt: new Date() },
  });
  return rowToRecommendation(row);
}

export async function undismissRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation> {
  await assertRecommendationOwned(userId, recId);
  const row = await prisma.recommendation.update({
    where: { id: recId },
    data: { dismissedAt: null },
  });
  return rowToRecommendation(row);
}

/**
 * Link a brief to a project (or unlink with null). Reviews already opened
 * from its recommendations come along when they aren't in a project yet;
 * reviews filed elsewhere stay where the user put them.
 */
export async function setDiscoverQueryProject(
  userId: string,
  queryId: string,
  projectId: string | null,
): Promise<{ query: DiscoverQuery; movedReviewIds: string[] }> {
  await assertDiscoverQueryOwned(userId, queryId);
  if (projectId) await assertProjectOwned(userId, projectId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.discoverQuery.update({
      where: { id: queryId },
      data: { projectId },
    });
    let movedReviewIds: string[] = [];
    if (projectId) {
      const reviews = await tx.review.findMany({
        where: {
          userId,
          projectId: null,
          fromRecommendation: { queryId },
        },
        select: { id: true },
      });
      movedReviewIds = reviews.map((r) => r.id);
      if (movedReviewIds.length > 0) {
        await tx.review.updateMany({
          where: { id: { in: movedReviewIds } },
          data: { projectId },
        });
      }
    }
    return { query: rowToDiscoverQuery(row), movedReviewIds };
  });
}

export async function deleteDiscoverQuery(
  userId: string,
  queryId: string,
): Promise<void> {
  await assertDiscoverQueryOwned(userId, queryId);
  // Cascade on Recommendation handles its rows. fromRecommendationId on
  // any Reviews already pointing at recs in this query becomes null
  // automatically (SetNull), preserving the reviews.
  await prisma.discoverQuery.delete({ where: { id: queryId } });
}

/**
 * Open a recommendation: get-or-create the matching Review and link the
 * rec to it via fromRecommendationId on newly created reviews. Re-surfaces
 * (rec for a paper the user already has) just return the existing review
 * without overwriting the original origin.
 */
export async function openRecommendation(
  userId: string,
  recId: string,
): Promise<{ review: PaperReview; alreadyInLibrary: boolean }> {
  const rec = await getRecommendation(userId, recId);
  if (!rec) throw new HttpError(404, `Recommendation not found: ${recId}`);

  // Research that belongs to a project files what it opens into that
  // project, so reading from a project brief needs no manual linking.
  const query = await prisma.discoverQuery.findFirst({
    where: { id: rec.queryId, userId },
    select: { projectId: true },
  });
  const projectId = query?.projectId ?? null;

  const canonicalArxivId = rec.arxivId ? normalizeArxivId(rec.arxivId) : null;
  const existing = canonicalArxivId
    ? await getReviewByArxivId(userId, canonicalArxivId)
    : await getReviewBySourceUrl(userId, rec.url);
  if (existing) {
    // An ungrouped paper joins the project; one already filed elsewhere
    // stays where the user put it.
    if (projectId && !existing.projectId) {
      const moved = await assignReviewToProject(userId, existing.id, projectId);
      return { review: moved, alreadyInLibrary: true };
    }
    return { review: existing, alreadyInLibrary: true };
  }

  const now = new Date().toISOString();
  const fallbackTitle = canonicalArxivId ? `arXiv:${canonicalArxivId}` : rec.url;
  const review = await insertReview(
    userId,
    {
      id: crypto.randomUUID(),
      title: rec.title || fallbackTitle,
      arxivId: canonicalArxivId,
      createdAt: now,
      updatedAt: now,
      pdfPath: null,
      sourceUrl: canonicalArxivId ? null : rec.url,
    },
    recId,
    projectId,
  );
  return { review, alreadyInLibrary: false };
}

/* ── Projects ─────────────────────────────────────────────────── */

function rowToProject(r: {
  id: string;
  name: string;
  createdAt: Date;
}): Project {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToProject);
}

export async function createProject(
  userId: string,
  data: { name: string },
): Promise<Project> {
  const row = await prisma.project.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      name: data.name,
    },
  });
  return rowToProject(row);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: { name?: string },
): Promise<Project> {
  const existing = await prisma.project.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, `Project not found: ${id}`);
  const row = await prisma.project.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    },
  });
  return rowToProject(row);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const existing = await prisma.project.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, `Project not found: ${id}`);
  // The DB constraints do the rest: its papers are unfiled (SetNull on
  // Review.projectId) and its research briefs are deleted (Cascade on
  // DiscoverQuery.projectId, and on to their recommendations).
  await prisma.project.delete({ where: { id } });
}

export async function assignReviewToProject(
  userId: string,
  reviewId: string,
  projectId: string | null,
): Promise<PaperReview> {
  const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  if (projectId !== null) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw new HttpError(404, `Project not found: ${projectId}`);
  }
  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { projectId },
  });
  return rowToReview(updated);
}
