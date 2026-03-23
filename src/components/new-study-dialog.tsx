"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
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

  if (!open) return null;

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

    // Notify sidebar to refresh
    window.dispatchEvent(new Event("studies-updated"));

    setUrl("");
    setTitle("");
    onCreated(study.id);
  };

  const handleClose = () => {
    setUrl("");
    setTitle("");
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative w-full max-w-md mx-4 bg-bg-tertiary border border-border-light rounded-2xl shadow-[var(--shadow-lg)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">
            New study session
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-5 pb-4 space-y-4">
            {/* URL Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Arxiv URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://arxiv.org/abs/2602.00277"
                autoFocus
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus transition-all"
              />
              {arxivId && (
                <p className="text-xs text-success">
                  Detected: arxiv:{arxivId}
                </p>
              )}
              {error && (
                <p className="text-xs text-danger">{error}</p>
              )}
            </div>

            {/* Optional Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                Title{" "}
                <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give this study a name..."
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus transition-all"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3.5 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Create study
              <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
