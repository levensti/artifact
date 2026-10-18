"use client";

import { useEffect, useState } from "react";
import { createProject, deleteProject, updateProject } from "@/lib/client-data";
import type { Project } from "@/lib/review-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/* ── ProjectDialog ───────────────────────────────────────────── */

export function ProjectDialog(
  props:
    | {
        mode: "create";
        open: boolean;
        onClose: () => void;
        /** Prefilled name, e.g. drafted from a brief's question. */
        initialName?: string;
        onCreated?: (project: Project) => void | Promise<void>;
      }
    | { mode: "edit"; project: Project; open: boolean; onClose: () => void },
) {
  const startName =
    props.mode === "edit" ? props.project.name : (props.initialName ?? "");
  const [name, setName] = useState(startName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.open) setName(startName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (props.mode === "create") {
        const project = await createProject(name.trim());
        await props.onCreated?.(project);
      } else {
        await updateProject(props.project.id, { name: name.trim() });
      }
      props.onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {props.mode === "create" ? "New project" : "Rename project"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Project name"
            onFocus={(e) => e.currentTarget.select()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My thesis, Agent memory…"
            // A name field, not a login: keep browser autofill and password
            // managers from attaching to it.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Saving…" : props.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── DeleteProjectDialog ─────────────────────────────────────── */

export function DeleteProjectDialog({
  project,
  paperCount,
  briefCount,
  onClose,
  onDeleted,
}: {
  project: Project;
  paperCount: number;
  /** Research briefs in the project, which are deleted with it. */
  briefCount: number;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
      onClose();
      onDeleted?.();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !deleting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            &ldquo;{project.name}&rdquo; will be deleted
            {briefCount > 0
              ? `, along with its ${briefCount === 1 ? "research brief" : `${briefCount} research briefs`}.`
              : "."}
            {paperCount > 0 &&
              ` ${paperCount === 1 ? "Its review is kept" : `Its ${paperCount} reviews are kept`}, outside any project.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
