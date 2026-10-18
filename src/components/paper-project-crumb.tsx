"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FolderOpen, FolderX, Plus } from "lucide-react";
import {
  assignReviewToProject,
  getReviewsSnapshot,
} from "@/lib/client-data";
import { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";
import { useProjects } from "@/hooks/use-projects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The review's project id, kept current as it's moved anywhere in the app. */
function useReviewProjectId(reviewId: string, initial: string | null): string | null {
  const [projectId, setProjectId] = useState(initial);
  useEffect(() => {
    const sync = () => {
      const review = getReviewsSnapshot().find((r) => r.id === reviewId);
      if (review) setProjectId(review.projectId ?? null);
    };
    sync();
    window.addEventListener(REVIEWS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, sync);
  }, [reviewId]);
  return projectId;
}

/**
 * The paper's project, leading its title in the viewer toolbar: the project
 * name links to its page, and the chevron moves the paper to another project
 * or out of it. An unfiled paper offers "Add to project" instead. Projects
 * are created on the Projects page, not here.
 */
export default function PaperProjectCrumb({
  reviewId,
  projectId: initialProjectId,
}: {
  reviewId: string;
  projectId: string | null;
}) {
  const router = useRouter();
  const projects = useProjects();
  const projectId = useReviewProjectId(reviewId, initialProjectId);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const menu = (
    <DropdownMenuContent align="start" className="min-w-48 max-w-72">
      {projects.length === 0 ? (
        <DropdownMenuItem onClick={() => router.push("/projects")}>
          <Plus className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
          Create a project first
        </DropdownMenuItem>
      ) : (
        projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => {
              if (p.id !== projectId) void assignReviewToProject(reviewId, p.id);
            }}
          >
            <FolderOpen className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{p.name}</span>
            {p.id === projectId ? (
              <Check className="ml-auto size-3.5 shrink-0" strokeWidth={2} />
            ) : null}
          </DropdownMenuItem>
        ))
      )}
      {project ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void assignReviewToProject(reviewId, null)}>
            <FolderX className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
            Remove from project
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );

  if (!project) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add this review to a project"
        >
          <Plus className="size-3" strokeWidth={2} aria-hidden />
          Add to project
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }

  return (
    <span className="inline-flex min-w-0 shrink items-center">
      <Link
        href={`/projects/${project.id}`}
        className="min-w-0 truncate rounded px-1 py-0.5 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        title={`Open ${project.name}`}
      >
        {project.name}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Move this review to another project"
        >
          <ChevronDown className="size-3" strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    </span>
  );
}
