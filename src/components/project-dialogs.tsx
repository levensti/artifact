"use client";

import { useEffect, useState } from "react";
import { createProject, deleteProject, updateProject } from "@/lib/client-data";
import type { Project } from "@/lib/review-types";

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
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-3"
        >
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Name
            </label>
            <input
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My thesis, NLP papers…"
              className="h-8 w-full rounded-lg border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
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

export function DeleteProjectDialog({
  project,
  paperCount,
  onClose,
  onDeleted,
}: {
  project: Project;
  paperCount: number;
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
            ` ${paperCount} ${paperCount === 1 ? "paper" : "papers"} will be ungrouped but not deleted.`}{" "}
          Its research briefs stay in Artifacts.
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
