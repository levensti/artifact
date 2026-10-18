"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus } from "lucide-react";
import {
  ensureDiscoverLoaded,
  getDiscoverQueriesSnapshot,
  getReviewsSnapshot,
  hydrateClientStore,
} from "@/lib/client-data";
import { getThreadParent } from "@/lib/discover-threads";
import { formatRelative } from "@/lib/format-relative";
import {
  DISCOVER_UPDATED_EVENT,
  REVIEWS_UPDATED_EVENT,
} from "@/lib/storage-events";
import { useProjects } from "@/hooks/use-projects";
import type { Project } from "@/lib/review-types";
import PageHeader from "./page-header";
import { ProjectDialog } from "./project-dialogs";

interface ProjectSummary {
  project: Project;
  papers: number;
  /** Research briefs (threads), not counting follow-ups. */
  briefs: number;
  /** A brief is still being researched. */
  running: boolean;
  /** Latest of: created, a paper opened, a brief started. */
  lastActivity: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Re-render when reviews or research change anywhere in the app. */
function useLibraryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(REVIEWS_UPDATED_EVENT, bump);
    window.addEventListener(DISCOVER_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(REVIEWS_UPDATED_EVENT, bump);
      window.removeEventListener(DISCOVER_UPDATED_EVENT, bump);
    };
  }, []);
  return version;
}

/**
 * Placeholder while projects load, in the list's own shape (same panel, a
 * folder, a title and a meta line per row) so the page doesn't jump when
 * the real rows arrive.
 */
function ProjectsSkeleton() {
  const widths = ["46%", "62%", "38%"];
  return (
    <ul
      className="animate-pulse divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "var(--shadow-sm)" }}
      aria-label="Loading projects"
    >
      {widths.map((w, i) => (
        <li key={i} className="flex items-center gap-4 px-6 py-4">
          <div className="size-4 shrink-0 rounded bg-muted-foreground/10" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 rounded-full bg-muted-foreground/15" style={{ width: w }} />
            <div className="mt-2 h-2.5 w-40 rounded-full bg-muted-foreground/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Projects page: every project with what it holds, newest activity
 * first. A project is where research happens (asking on Home starts one) and
 * where papers are filed; opening one leads to its page.
 */
export default function ProjectsPanel() {
  const router = useRouter();
  const projects = useProjects();
  const version = useLibraryVersion();
  const [hydrated, setHydrated] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([hydrateClientStore(), ensureDiscoverLoaded()]);
      } catch (err) {
        // Show what loaded (or the empty state) rather than a skeleton forever.
        console.error("Failed to load projects:", err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summaries = useMemo<ProjectSummary[]>(() => {
    void version;
    const reviews = getReviewsSnapshot();
    const queries = getDiscoverQueriesSnapshot();
    return projects
      .map((project) => {
        const papers = reviews.filter((r) => r.projectId === project.id);
        const runs = queries.filter((q) => q.projectId === project.id);
        const stamps = [
          project.createdAt,
          ...papers.map((r) => r.updatedAt),
          ...runs.map((q) => q.createdAt),
        ];
        return {
          project,
          papers: papers.length,
          briefs: runs.filter((q) => !getThreadParent(q.id)).length,
          running: runs.some((q) => q.status === "running"),
          lastActivity: stamps.reduce((a, b) =>
            new Date(b).getTime() > new Date(a).getTime() ? b : a,
          ),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
      );
  }, [projects, version]);

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "var(--reader-mat)" }}
    >
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
        <PageHeader
          title="Projects"
          actions={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New project
            </button>
          }
        />

        {!hydrated ? (
          <ProjectsSkeleton />
        ) : summaries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[15px] font-medium text-foreground">
              No projects yet
            </p>
            <p className="mx-auto mt-1.5 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
              Ask a question on{" "}
              <Link
                href="/"
                className="underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              >
                Home
              </Link>{" "}
              to start one with a research brief, or create an empty project
              and file reviews into it.
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            {summaries.map((s) => (
              <li key={s.project.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/projects/${s.project.id}`)}
                  className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
                >
                  <FolderOpen
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {s.project.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      {s.running ? (
                        <span className="inline-flex items-center gap-1.5 text-primary">
                          <span className="landing-pulse-dot" />
                          Researching
                        </span>
                      ) : null}
                      <span>
                        {[
                          plural(s.papers, "review", "reviews"),
                          plural(s.briefs, "brief", "briefs"),
                          `Active ${formatRelative(s.lastActivity)}`,
                        ].join(" · ")}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectDialog
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(project) => router.push(`/projects/${project.id}`)}
      />
    </div>
  );
}
