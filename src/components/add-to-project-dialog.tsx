"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, FolderPlus, Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PROJECTS_UPDATED_EVENT,
  createProject,
  getProjects,
  loadReviewProjects,
  setReviewProjects,
} from "@/lib/projects";
import type { Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

interface AddToProjectDialogProps {
  /// The review being placed into projects. Title is shown in the header
  /// so the user is anchored when this dialog is opened from a sidebar
  /// row deep in a long list.
  reviewId: string | null;
  reviewTitle: string | null;
  open: boolean;
  onClose: () => void;
}

function subscribeProjects(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
}

function projectsSnapshot() {
  return JSON.stringify(getProjects());
}

function projectsServerSnapshot() {
  return "[]";
}

export default function AddToProjectDialog({
  reviewId,
  reviewTitle,
  open,
  onClose,
}: AddToProjectDialogProps) {
  const projectsJson = useSyncExternalStore(
    subscribeProjects,
    projectsSnapshot,
    projectsServerSnapshot,
  );
  const projects = useMemo(
    () => JSON.parse(projectsJson) as Project[],
    [projectsJson],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the review's current memberships when the dialog opens.
  useEffect(() => {
    if (!open || !reviewId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const ids = await loadReviewProjects(reviewId);
        if (cancelled) return;
        const set = new Set(ids);
        setSelected(set);
        setInitial(set);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load memberships",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reviewId]);

  // Reset transient state on close.
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewName("");
      setError(null);
    }
  }, [open]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  const toggle = (projectId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const submit = async () => {
    if (!reviewId || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await setReviewProjects(reviewId, Array.from(selected));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(trimmed);
      // Auto-select the newly-created project — the user almost always
      // wants the review they just opened the dialog for to land in it.
      setSelected((prev) => new Set([...prev, project.id]));
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to project</DialogTitle>
          <DialogDescription>
            {reviewTitle ? (
              <span className="line-clamp-2">
                Place “{reviewTitle}” into one or more projects.
              </span>
            ) : (
              "Pick projects to attach this review to."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <FolderPlus
                className="size-5 text-muted-foreground/50"
                strokeWidth={1.5}
              />
              <p className="text-[12px] text-muted-foreground/80">
                No projects yet.
              </p>
            </div>
          ) : (
            projects.map((project) => {
              const checked = selected.has(project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => toggle(project.id)}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                    checked
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground/85 hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-transparent",
                    )}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {project.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
                    {project.reviewCount}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New project name"
              maxLength={120}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitCreate();
                } else if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
            />
            <Button
              size="sm"
              onClick={submitCreate}
              disabled={busy || !newName.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 self-start rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            New project
          </button>
        )}

        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !dirty || loading}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
