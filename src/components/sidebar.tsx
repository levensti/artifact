"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  FilePen,
  FilePlus,
  AlertCircle,
  KeyRound,
  Share2,
  Compass,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderInput,
  FolderX,
} from "lucide-react";
import { canShareReview } from "@/lib/client/sharing/share-links";
import {
  getReviews,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import {
  getWikiCacheSnapshot,
  loadWikiPages,
  getProjectsSnapshot,
  createProject,
  updateProject,
  deleteProject,
  assignReviewToProject,
} from "@/lib/client-data";
import type { Project } from "@/lib/review-types";
import { hasUsableProvider } from "@/lib/keys";
import {
  KEYS_UPDATED_EVENT,
  WIKI_UPDATED_EVENT,
  PROJECTS_UPDATED_EVENT,
} from "@/lib/storage-events";
import { useSettingsOpener } from "@/components/settings-opener-context";
import {
  getWikiIngestError,
  getWikiIngestSnapshot,
  reportWikiIngestError,
  subscribeWikiStatus,
} from "@/lib/wiki-status";
import { cn } from "@/lib/utils";
import { localDateKey, localDateKeyFromIso } from "@/lib/date-keys";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MonoLabel } from "@/components/folio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import NewReviewDialog from "./new-review-dialog";
import ShareReviewDialog from "./share-review-dialog";
import UserMenu from "./user-menu";

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(WIKI_UPDATED_EVENT, onStoreChange);
  window.addEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(WIKI_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
  };
}

function subscribeKeys(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(KEYS_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(KEYS_UPDATED_EVENT, onStoreChange);
}

function keysSnapshot(): string {
  // A platform fallback counts as usable — a fresh user shouldn't see a
  // "Set up" nag when chat already works out of the box.
  return hasUsableProvider() ? "1" : "0";
}

function keysServerSnapshot(): string {
  return "0";
}

function reviewsSnapshot() {
  const wikiPages = getWikiCacheSnapshot() ?? [];
  return JSON.stringify({
    reviews: getReviews(),
    wikiPageCount: wikiPages.length,
    projects: getProjectsSnapshot(),
  });
}

function reviewsServerSnapshot() {
  return JSON.stringify({ reviews: [], wikiPageCount: 0, projects: [] });
}

interface SidebarProps {
  collapsed: boolean;
  /** Narrow screens: `overlay` = fixed drawer; `inline` = flex column (or w-0 when collapsed). */
  presentation?: "inline" | "overlay";
}

export default function Sidebar({
  collapsed,
  presentation = "inline",
}: SidebarProps) {
  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    reviewsSnapshot,
    reviewsServerSnapshot,
  );
  const { reviews, wikiPageCount, projects } = useMemo(() => {
    const parsed = JSON.parse(reviewsJson) as {
      reviews: PaperReview[];
      wikiPageCount: number;
      projects: Project[];
    };
    return {
      reviews: parsed.reviews ?? [],
      wikiPageCount: parsed.wikiPageCount ?? 0,
      projects: parsed.projects ?? [],
    };
  }, [reviewsJson]);

  // Ambient ingest status — shows a pulsing dot + label beside the
  // Journal button whenever a background wiki operation is in flight.
  const activeIngests = useSyncExternalStore(
    subscribeWikiStatus,
    getWikiIngestSnapshot,
    getWikiIngestSnapshot,
  );
  const ingestError = useSyncExternalStore(
    subscribeWikiStatus,
    getWikiIngestError,
    () => null,
  );
  const ingestActive = activeIngests.length > 0;
  const ingestLabel = useMemo(() => {
    if (activeIngests.length === 0) return null;
    if (activeIngests.length === 1) {
      const only = activeIngests[0];
      if (only.kind === "journal") return "Journaling…";
      return "Syncing…";
    }
    return `${activeIngests.length} running`;
  }, [activeIngests]);
  const [showNewReview, setShowNewReview] = useState(false);
  const [shareTarget, setShareTarget] = useState<PaperReview | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const { openSettings } = useSettingsOpener();
  const keysFlag = useSyncExternalStore(
    subscribeKeys,
    keysSnapshot,
    keysServerSnapshot,
  );
  const hasKeys = keysFlag === "1";

  // Ensure wiki cache is populated so the snapshot picks up page counts
  useEffect(() => {
    void loadWikiPages().catch(() => {
      // Sidebar polls on a cadence via WIKI_UPDATED_EVENT — failures here
      // are non-fatal and would otherwise pollute devtools with noise.
    });
  }, []);

  const handleReviewCreated = (reviewId: string) => {
    setShowNewReview(false);
    router.push(`/review/${reviewId}`);
  };

  const projectReviews = useMemo(() => {
    const map = new Map<string, PaperReview[]>();
    for (const p of projects) map.set(p.id, []);
    for (const r of reviews) {
      if (r.projectId && map.has(r.projectId)) {
        map.get(r.projectId)!.push(r);
      }
    }
    return map;
  }, [reviews, projects]);

  const grouped = useMemo(() => {
    const ungrouped = reviews.filter((r) => !r.projectId);
    const byDate = new Map<string, PaperReview[]>();
    for (const r of ungrouped) {
      const dateKey = localDateKeyFromIso(r.createdAt);
      const list = byDate.get(dateKey) ?? [];
      list.push(r);
      byDate.set(dateKey, list);
    }

    const sortedKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    const todayKey = localDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayKey = localDateKey(yesterdayDate);

    const now = new Date();
    const sameYear = (y: number) => y === now.getFullYear();

    return sortedKeys.map((dateKey) => {
      const [yy, mm, dd] = dateKey.split("-").map(Number);
      const d = new Date(yy, mm - 1, dd);
      const short = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear(yy) ? {} : { year: "numeric" }),
      });
      let label = short;
      if (dateKey === todayKey) label = `Today · ${short}`;
      else if (dateKey === yesterdayKey) label = `Yesterday · ${short}`;
      return { key: dateKey, label, items: byDate.get(dateKey)! };
    });
  }, [reviews]);

  // Wiki page count comes from the snapshot (no extra memo needed)

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden",
          presentation === "overlay"
            ? "fixed inset-y-0 left-0 z-40 w-[min(272px,85vw)] shrink-0 shadow-xl shadow-black/10 safe-area-x"
            : "shrink-0 transition-sidebar",
          presentation === "inline" &&
            (collapsed ? "w-0 border-r-0" : "w-[272px]"),
        )}
      >
        <div className="shrink-0 px-2 pb-2 pt-5">
          <div className="mb-4 flex items-start justify-between gap-2 px-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-foreground">
                <svg viewBox="4 4 24 24" aria-hidden className="size-[18px]">
                  <path
                    d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
                    fill="#fafafa"
                    opacity="0.35"
                  />
                  <circle cx="22" cy="10" r="3.2" fill="#fafafa" />
                </svg>
              </span>
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[18px] font-bold tracking-[-0.025em] text-foreground">
                  Artifact
                </span>
                <span
                  className="truncate text-[11px] font-normal italic"
                  style={{
                    fontFamily: "var(--font-reading)",
                    color:
                      "color-mix(in srgb, var(--primary) 75%, transparent)",
                  }}
                >
                  Push the frontier.
                </span>
              </div>
            </div>
            <a
              href="https://github.com/levensti/artifact"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View Artifact on GitHub"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
                className="size-[22px]"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.486 2 12.02c0 4.424 2.865 8.178 6.839 9.504.5.092.682-.218.682-.483 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.032 1.531 1.032.892 1.531 2.341 1.089 2.91.832.092-.648.35-1.09.636-1.341-2.22-.253-4.555-1.113-4.555-4.954 0-1.094.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.845c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.027 2.748-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.594 1.028 2.688 0 3.85-2.339 4.697-4.566 4.946.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.481A10.02 10.02 0 0 0 22 12.02C22 6.486 17.523 2 12 2Z"
                />
              </svg>
            </a>
          </div>
          <button
            type="button"
            onClick={() => setShowNewReview(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <span className="flex w-6 shrink-0 items-center justify-center">
              <FilePlus
                className="size-3.75 text-primary/85"
                strokeWidth={1.75}
              />
            </span>
            <span className="truncate">Start a review</span>
          </button>
          <button
            type="button"
            onClick={() => router.push("/discover")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
              pathname === "/discover"
                ? "bg-sidebar-accent text-foreground font-medium"
                : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <span className="flex w-6 shrink-0 items-center justify-center">
              <Compass
                className="size-3.75 text-primary/85"
                strokeWidth={1.75}
              />
            </span>
            <span className="truncate">Discover</span>
          </button>
          <button
            type="button"
            onClick={() => router.push("/journal")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
              pathname === "/journal"
                ? "bg-sidebar-accent text-foreground font-medium"
                : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <span className="relative flex w-6 shrink-0 items-center justify-center">
              <FilePen className="size-[15px] opacity-80" strokeWidth={1.75} />
              {ingestActive ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary animate-pulse"
                />
              ) : null}
            </span>
            <span className="truncate">Journal</span>
            {ingestActive ? (
              <span className="ml-auto text-[10px] font-medium italic text-primary/80 animate-pulse">
                {ingestLabel}
              </span>
            ) : null}
            {wikiPageCount > 0 && !ingestActive ? (
              <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-sidebar-accent/80 px-1.5 py-0.5 tabular-nums text-[10px] font-semibold text-muted-foreground">
                {wikiPageCount}
              </span>
            ) : null}
          </button>
          {ingestError ? (
            <div
              className="mx-1 mt-2 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive"
              role="status"
            >
              <AlertCircle className="mt-px size-3 shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate" title={ingestError}>
                Ingest failed: {ingestError}
              </span>
              <button
                type="button"
                onClick={() => reportWikiIngestError(null)}
                className="shrink-0 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => openSettings()}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground"
            aria-label={
              hasKeys ? "Manage API keys" : "Add an API key to start chatting"
            }
          >
            <span className="relative flex w-6 shrink-0 items-center justify-center">
              <KeyRound className="size-[15px] opacity-80" strokeWidth={1.75} />
              {!hasKeys ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
                  style={{
                    background: "var(--primary)",
                    boxShadow: "0 0 0 2px var(--sidebar)",
                  }}
                />
              ) : null}
            </span>
            <span className="truncate">API keys</span>
            {!hasKeys ? (
              <span
                className="ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase"
                style={{
                  background: "var(--badge-accent-bg)",
                  color: "var(--badge-accent-fg)",
                  letterSpacing: "0.06em",
                }}
              >
                Set up
              </span>
            ) : null}
          </button>
        </div>

        {/* Projects section */}
        {projects.length > 0 && (
          <div className="mx-2 mt-3 shrink-0 border-t border-sidebar-border/60 pt-2">
            <div className="flex items-center justify-between px-2 py-1">
              <MonoLabel>Projects</MonoLabel>
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                title="New project"
                className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-sidebar-accent hover:text-foreground"
              >
                <FolderPlus className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {projects.length === 0 ? null : (
          <div className="shrink-0 px-2 pb-1">
            {projects.map((project) => {
              const isCollapsed = collapsedProjects.has(project.id);
              const items = projectReviews.get(project.id) ?? [];
              return (
                <div key={project.id} className="mb-1">
                  <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-sidebar-accent/50">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedProjects((prev) => {
                          const next = new Set(prev);
                          if (next.has(project.id)) next.delete(project.id);
                          else next.add(project.id);
                          return next;
                        })
                      }
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150",
                          !isCollapsed && "rotate-90",
                        )}
                        strokeWidth={2}
                      />
                      {isCollapsed ? (
                        <Folder className="size-3.5 shrink-0 text-primary/70" strokeWidth={1.75} />
                      ) : (
                        <FolderOpen className="size-3.5 shrink-0 text-primary/70" strokeWidth={1.75} />
                      )}
                      <span className="truncate text-[12.5px] font-medium text-foreground/80">
                        {project.name}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-3.5" strokeWidth={2} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuItem
                          onClick={() => setEditingProject(project)}
                        >
                          <Pencil className="mr-2 size-3.5" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingProject(project)}
                        >
                          <Trash2 className="mr-2 size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {!isCollapsed && (
                    <div className="ml-5 flex flex-col gap-0.5 pl-1 pt-0.5">
                      {items.length === 0 ? (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground/50 italic">
                          No papers yet
                        </p>
                      ) : (
                        items.map((review) => (
                          <ReviewItem
                            key={review.id}
                            review={review}
                            projects={projects}
                            isActive={pathname === `/review/${review.id}`}
                            onNavigate={() => router.push(`/review/${review.id}`)}
                            onShare={() => setShareTarget(review)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mx-2 mt-3 mb-1 shrink-0 border-t border-sidebar-border/60 pt-2">
          <div className="flex items-center justify-between px-2 py-1">
            <MonoLabel>Reviews</MonoLabel>
            {projects.length === 0 && (
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                title="New project"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:bg-sidebar-accent hover:text-foreground"
              >
                <FolderPlus className="size-3" strokeWidth={1.75} />
                <span>New project</span>
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-2 pb-2 pt-1">
          {grouped.length === 0 && (
            <div className="mx-2 mt-8 flex flex-col items-center gap-2 text-center">
              <FilePlus
                className="size-5 text-muted-foreground/50"
                strokeWidth={1.5}
              />
              <p className="text-[12px] leading-relaxed text-muted-foreground/70">
                Your reviews will appear here.
              </p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.key} className="mb-5 last:mb-0">
              <p className="sticky top-0 z-10 mb-1 px-2 py-1 bg-sidebar/95 backdrop-blur-sm">
                <span
                  className="font-mono text-[10px] uppercase"
                  style={{
                    letterSpacing: "0.16em",
                    color:
                      "color-mix(in srgb, var(--muted-foreground) 60%, transparent)",
                  }}
                >
                  {group.label}
                </span>
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    projects={projects}
                    isActive={pathname === `/review/${review.id}`}
                    onNavigate={() => router.push(`/review/${review.id}`)}
                    onShare={() => setShareTarget(review)}
                  />
                ))}
              </div>
            </div>
          ))}
        </ScrollArea>

        <UserMenu />
      </aside>

      <NewReviewDialog
        open={showNewReview}
        onClose={() => setShowNewReview(false)}
        onCreated={handleReviewCreated}
      />
      <ShareReviewDialog
        review={shareTarget}
        onClose={() => setShareTarget(null)}
      />
      <ProjectDialog
        mode="create"
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
      />
      {editingProject && (
        <ProjectDialog
          mode="edit"
          project={editingProject}
          open={true}
          onClose={() => setEditingProject(null)}
        />
      )}
      {deletingProject && (
        <DeleteProjectDialog
          project={deletingProject}
          paperCount={projectReviews.get(deletingProject.id)?.length ?? 0}
          onClose={() => setDeletingProject(null)}
        />
      )}
    </>
  );
}

/* ── ReviewItem ──────────────────────────────────────────────── */

function ReviewItem({
  review,
  projects,
  isActive,
  onNavigate,
  onShare,
}: {
  review: PaperReview;
  projects: Project[];
  isActive: boolean;
  onNavigate: () => void;
  onShare: () => void;
}) {
  const isImported = Boolean(review.importedAt);
  const sharerFirstName = review.importedFromName
    ? review.importedFromName.split(/\s+/)[0]
    : null;
  const shareable = canShareReview(review);

  return (
    <div
      role="link"
      tabIndex={0}
      title={
        isImported
          ? sharerFirstName
            ? `${review.title} (imported from ${sharerFirstName}'s share)`
            : `${review.title} (imported from a share)`
          : review.title
      }
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-1.5 break-words rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
        isActive
          ? "bg-sidebar-accent font-medium text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 wrap-break-word">{review.title}</span>
      {isImported ? (
        <span
          className="mt-px inline-flex shrink-0 items-center rounded-full bg-(--badge-imported-bg) px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--badge-imported-fg)]"
          aria-label={
            sharerFirstName
              ? `Imported from ${sharerFirstName}'s share`
              : "Imported from a shared bundle"
          }
        >
          {sharerFirstName ? `From ${sharerFirstName}` : "Imported"}
        </span>
      ) : null}

      {shareable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShare();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          title="Share this review"
          aria-label={`Share ${review.title}`}
          className={cn(
            "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60",
            isActive
              ? "opacity-90"
              : "opacity-0 group-hover:opacity-90 group-focus-within:opacity-90",
          )}
        >
          <Share2 className="size-3" strokeWidth={2} />
        </button>
      ) : null}

      {/* Project assign dropdown */}
      {projects.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            title="Move to project"
            aria-label="Move to project"
            className={cn(
              "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60",
              isActive
                ? "opacity-90"
                : "opacity-0 group-hover:opacity-90 group-focus-within:opacity-90",
            )}
          >
            <FolderInput className="size-3" strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-44 max-w-72">
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (review.projectId !== p.id) {
                    void assignReviewToProject(review.id, p.id);
                  }
                }}
              >
                <Folder className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{p.name}</span>
                {review.projectId === p.id && (
                  <span className="ml-auto text-[10px] text-muted-foreground">✓</span>
                )}
              </DropdownMenuItem>
            ))}
            {review.projectId !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    void assignReviewToProject(review.id, null);
                  }}
                >
                  <FolderX className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
                  Remove from project
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/* ── ProjectDialog ───────────────────────────────────────────── */

function ProjectDialog(
  props:
    | { mode: "create"; open: boolean; onClose: () => void }
    | { mode: "edit"; project: Project; open: boolean; onClose: () => void },
) {
  const [name, setName] = useState(
    props.mode === "edit" ? props.project.name : "",
  );
  const [saving, setSaving] = useState(false);

  // Reset fields when dialog opens
  useEffect(() => {
    if (props.open) {
      setName(props.mode === "edit" ? props.project.name : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (props.mode === "create") {
        await createProject(name.trim());
      } else {
        await updateProject(props.project.id, { name: name.trim() });
      }
      props.onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.01em]">
          {props.mode === "create" ? "New project" : "Rename project"}
        </h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My thesis, NLP papers…"
              className="w-full rounded-md border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-md px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : props.mode === "create" ? "Create" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── DeleteProjectDialog ─────────────────────────────────────── */

function DeleteProjectDialog({
  project,
  paperCount,
  onClose,
}: {
  project: Project;
  paperCount: number;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">
          Delete project?
        </h2>
        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          &ldquo;{project.name}&rdquo; will be deleted.
          {paperCount > 0 &&
            ` ${paperCount} ${paperCount === 1 ? "paper" : "papers"} will be ungrouped but not deleted.`}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={deleting}
            className="rounded-md bg-destructive px-4 py-2 text-[13px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
