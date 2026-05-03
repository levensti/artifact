"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { createProject } from "@/lib/projects";
import type { Project } from "@/lib/projects";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: Project) => void;
}

export default function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your project a name");
      return;
    }
    setBusy(true);
    try {
      const project = await createProject(trimmed, description.trim() || null);
      onCreated?.(project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A scoped workspace for a set of related papers. Add reviews and
            return to one place to revisit them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Name
            </span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. RLHF deep dive"
              maxLength={120}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Description{" "}
              <span className="font-normal text-muted-foreground/60">
                (optional)
              </span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the question, milestone, or thread you're working on?"
              rows={3}
              maxLength={500}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/60"
            />
          </label>
          {error ? (
            <p className="text-[12px] text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
