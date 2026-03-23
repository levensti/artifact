"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
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
import { createStudy } from "@/lib/studies";
import { extractArxivId } from "@/lib/utils";

interface NewStudyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (studyId: string) => void;
}

export default function NewStudyDialog({ open, onClose, onCreated }: NewStudyDialogProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const arxivId = extractArxivId(url);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Please enter an Arxiv URL");
      return;
    }

    if (!arxivId) {
      setError("Please enter a valid Arxiv URL (e.g., https://arxiv.org/abs/2602.00277)");
      return;
    }

    const studyTitle = title.trim() || `Paper ${arxivId}`;
    const study = createStudy(arxivId, studyTitle);
    window.dispatchEvent(new Event("studies-updated"));

    setUrl("");
    setTitle("");
    onCreated(study.id);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setUrl("");
      setTitle("");
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New study session</DialogTitle>
          <DialogDescription>
            Paste an Arxiv URL to start reading a paper with your AI copilot.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Arxiv URL
              </label>
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://arxiv.org/abs/2602.00277"
                autoFocus
              />
              {arxivId && (
                <p className="text-xs text-emerald-500">
                  Detected: arxiv:{arxivId}
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Title{" "}
                <span className="font-normal opacity-60">(optional)</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give this study a name..."
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              Create study
              <ArrowRight size={14} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
