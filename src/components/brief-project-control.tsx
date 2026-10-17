"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  FolderX,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setDiscoverQueryProject } from "@/lib/client-data";
import { useProjects } from "@/hooks/use-projects";
import { cn } from "@/lib/utils";
import { ProjectDialog } from "./project-dialogs";

/** A project name drafted from the brief's question: no trailing "?",
 *  trimmed to a sidebar-friendly length at a word boundary. */
export function draftProjectName(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  const capped =
    clean.length <= 60 ? clean : clean.slice(0, 60).replace(/\s+\S*$/, "");
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/**
 * Where a brief lives. Unlinked: "Add to project", which can also start a
 * new project named after the question. Linked: the project's name, linking
 * to its page, with a menu to move or remove it. The brief's follow-ups
 * move with it.
 */
export default function BriefProjectControl({
  question,
  projectId,
  queryIds,
}: {
  question: string;
  projectId: string | null;
  /** The brief and its follow-ups, linked together. */
  queryIds: string[];
}) {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = projectId
    ? (projects.find((p) => p.id === projectId) ?? null)
    : null;

  const link = async (id: string | null) => {
    if (id === projectId || saving) return;
    setSaving(true);
    try {
      await Promise.all(queryIds.map((q) => setDiscoverQueryProject(q, id)));
    } finally {
      setSaving(false);
    }
  };

  const menu = (
    <DropdownMenuContent align="end" className="min-w-56 max-w-72">
      <DropdownMenuItem onClick={() => setCreating(true)}>
        <FolderPlus className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
        New project from this brief
      </DropdownMenuItem>
      {projects.length > 0 ? <DropdownMenuSeparator /> : null}
      {projects.map((p) => (
        <DropdownMenuItem key={p.id} onClick={() => void link(p.id)}>
          <Folder className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{p.name}</span>
          {p.id === projectId ? (
            <Check className="ml-auto size-3.5 shrink-0" strokeWidth={2} />
          ) : null}
        </DropdownMenuItem>
      ))}
      {projectId ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void link(null)}>
            <FolderX className="mr-2 size-3.5 shrink-0" strokeWidth={1.75} />
            Remove from project
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );

  const buttonClass =
    "inline-flex h-8 items-center gap-1.5 rounded-md text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <>
      {current ? (
        <div className="inline-flex items-center rounded-md border border-border bg-card">
          <Link
            href={`/projects/${current.id}`}
            className={cn(
              buttonClass,
              "max-w-[220px] rounded-r-none px-2.5 font-medium text-foreground hover:bg-muted",
            )}
          >
            <Folder
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <span className="truncate">{current.name}</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Move to another project"
              className={cn(
                buttonClass,
                "rounded-l-none border-l border-border px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ChevronDown className="size-3.5" strokeWidth={2} />
              )}
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonClass,
              "border border-border bg-card px-2.5 font-medium text-foreground hover:bg-muted",
            )}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderPlus
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
            )}
            Add to project
            <ChevronDown
              className="size-3.5 text-muted-foreground"
              strokeWidth={2}
            />
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      )}

      <ProjectDialog
        mode="create"
        open={creating}
        initialName={draftProjectName(question)}
        onClose={() => setCreating(false)}
        onCreated={(project) => link(project.id)}
      />
    </>
  );
}
