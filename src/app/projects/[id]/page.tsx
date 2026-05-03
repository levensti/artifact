"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import {
  PROJECTS_UPDATED_EVENT,
  deleteProject,
  loadProject,
  removeReviewFromProject,
  updateProject,
} from "@/lib/projects";
import type { ProjectWithReviews } from "@/lib/projects";
import {
  REVIEWS_UPDATED_EVENT,
  getReviews,
  type PaperReview,
} from "@/lib/reviews";
import { hydrateClientStore } from "@/lib/client-data";
import { getSavedSelectedModel, saveSelectedModel } from "@/lib/keys";
import type { Model } from "@/lib/models";
import { formatRelative } from "@/lib/format-relative";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AddReviewToProjectPicker from "@/components/add-review-to-project-picker";
import BulkAddPapersDialog from "@/components/bulk-add-papers-dialog";
import ProjectChatPanel from "@/components/project-chat-panel";

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(PROJECTS_UPDATED_EVENT, onStoreChange);
  };
}

function reviewsSnapshot() {
  return JSON.stringify(getReviews());
}

function reviewsServerSnapshot() {
  return "[]";
}

type Tab = "papers" | "chat" | "notes";

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const [project, setProject] = useState<ProjectWithReviews | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<Tab>("papers");

  // Selected model for project chat — persisted via the existing
  // user-preferences endpoint so the choice carries over from per-paper
  // chats.
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  useEffect(() => {
    setSelectedModel(getSavedSelectedModel());
  }, []);
  const onModelChange = (m: Model | null) => {
    setSelectedModel(m);
    void saveSelectedModel(m);
  };

  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    reviewsSnapshot,
    reviewsServerSnapshot,
  );
  const allReviews = useMemo(
    () => JSON.parse(reviewsJson) as PaperReview[],
    [reviewsJson],
  );

  const refresh = useCallback(async () => {
    setError(null);
    const fresh = await loadProject(projectId);
    if (!fresh) {
      setError("Project not found");
      setProject(null);
    } else {
      setProject(fresh);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateClientStore();
      try {
        const fresh = await loadProject(projectId);
        if (cancelled) return;
        if (!fresh) {
          setError("Project not found");
        } else {
          setProject(fresh);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load project",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    const handler = () => {
      void refresh();
    };
    window.addEventListener(PROJECTS_UPDATED_EVENT, handler);
    window.addEventListener(REVIEWS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PROJECTS_UPDATED_EVENT, handler);
      window.removeEventListener(REVIEWS_UPDATED_EVENT, handler);
    };
  }, [project, refresh]);

  const memberReviews = useMemo(() => {
    if (!project) return [] as PaperReview[];
    const byId = new Map(allReviews.map((r) => [r.id, r]));
    return project.reviewIds
      .map((id) => byId.get(id))
      .filter((r): r is PaperReview => Boolean(r));
  }, [project, allReviews]);

  const startEdit = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description ?? "");
    setEditing(true);
  };

  const saveMeta = async () => {
    if (!project) return;
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    setSavingMeta(true);
    try {
      const updated = await updateProject(project.id, {
        name: trimmedName,
        description: editDescription.trim() || null,
      });
      setProject({ ...project, ...updated, reviewIds: project.reviewIds });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingMeta(false);
    }
  };

  const onDelete = async () => {
    if (!project) return;
    try {
      await deleteProject(project.id);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setConfirmDelete(false);
    }
  };

  const handleRemoveReview = async (reviewId: string) => {
    if (!project) return;
    try {
      await removeReviewFromProject(project.id, reviewId);
      setProject({
        ...project,
        reviewIds: project.reviewIds.filter((id) => id !== reviewId),
        reviewCount: Math.max(0, project.reviewCount - 1),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove from project",
      );
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading project…
        </div>
      </DashboardLayout>
    );
  }

  if (error || !project) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <p className="text-[14px] font-semibold text-foreground">
            Project unavailable
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {error ?? "This project may have been deleted."}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => router.push("/")}
          >
            Back home
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="relative flex h-full flex-col overflow-hidden bg-background">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pt-8 pb-4 min-h-0">
          {/* Header */}
          {editing ? (
            <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-border bg-card px-4 py-3.5">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                maxLength={120}
                autoFocus
              />
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="What is this project about?"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/60"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={savingMeta}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveMeta}
                  disabled={savingMeta || !editName.trim()}
                >
                  {savingMeta ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <FolderOpen
                  className="mt-1 size-5 shrink-0 text-primary/70"
                  strokeWidth={1.75}
                />
                <div className="min-w-0">
                  <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">
                    {project.name}
                  </h1>
                  {project.description ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {project.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {project.reviewCount}{" "}
                    {project.reviewCount === 1 ? "paper" : "papers"} ·
                    Updated {formatRelative(project.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={startEdit}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="mb-3 flex shrink-0 items-center gap-0.5 border-b border-border/70">
            <TabButton
              icon={<FileText className="size-3.5" strokeWidth={1.75} />}
              label={`Papers (${memberReviews.length})`}
              active={tab === "papers"}
              onClick={() => setTab("papers")}
            />
            <TabButton
              icon={<MessageSquare className="size-3.5" strokeWidth={1.75} />}
              label="Ask across papers"
              active={tab === "chat"}
              onClick={() => setTab("chat")}
            />
            <TabButton
              icon={<StickyNote className="size-3.5" strokeWidth={1.75} />}
              label="Notes"
              active={tab === "notes"}
              onClick={() => setTab("notes")}
            />
          </div>

          {/* Tab body */}
          <div className="min-h-0 flex-1">
            {tab === "papers" ? (
              <PapersTab
                project={project}
                memberReviews={memberReviews}
                onRemove={handleRemoveReview}
                onOpenPicker={() => setPickerOpen(true)}
                onOpenBulk={() => setBulkOpen(true)}
                onOpenReview={(id) => router.push(`/review/${id}`)}
              />
            ) : tab === "chat" ? (
              <div className="h-full pb-2">
                <ProjectChatPanel
                  projectId={project.id}
                  projectName={project.name}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                />
              </div>
            ) : (
              <NotesTab
                projectId={project.id}
                initial={project.notes ?? ""}
                onSaved={(notes) =>
                  setProject({ ...project, notes })
                }
              />
            )}
          </div>
        </div>
      </div>

      <AddReviewToProjectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projectId={project.id}
        projectName={project.name}
        existingMemberIds={project.reviewIds}
        onAdded={() => void refresh()}
      />
      <BulkAddPapersDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        projectId={project.id}
        projectName={project.name}
        onAdded={() => void refresh()}
      />

      {confirmDelete ? (
        <DeleteConfirm
          name={project.name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
        />
      ) : null}
    </DashboardLayout>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground/85",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PapersTab({
  project,
  memberReviews,
  onRemove,
  onOpenPicker,
  onOpenBulk,
  onOpenReview,
}: {
  project: ProjectWithReviews;
  memberReviews: PaperReview[];
  onRemove: (id: string) => void | Promise<void>;
  onOpenPicker: () => void;
  onOpenBulk: () => void;
  onOpenReview: (id: string) => void;
}) {
  void project;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={onOpenPicker}>
          <Plus className="size-3.5" />
          Add existing
        </Button>
        <Button size="sm" onClick={onOpenBulk}>
          <Plus className="size-3.5" />
          Bulk add from arXiv
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {memberReviews.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <FileText
              className="size-5 text-muted-foreground/50"
              strokeWidth={1.5}
            />
            <p className="text-[12px] text-muted-foreground">
              No papers in this project yet.
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={onOpenPicker}>
                <Plus className="size-3.5" />
                Pick existing
              </Button>
              <Button size="sm" onClick={onOpenBulk}>
                <Plus className="size-3.5" />
                Paste a list
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {memberReviews.map((r) => (
              <div
                key={r.id}
                role="link"
                tabIndex={0}
                onClick={() => onOpenReview(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenReview(r.id);
                  }
                }}
                className="group flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/40"
              >
                <FileText
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                  {r.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {formatRelative(r.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRemove(r.id);
                  }}
                  title="Remove from project"
                  aria-label={`Remove ${r.title} from project`}
                  className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotesTab({
  projectId,
  initial,
  onSaved,
}: {
  projectId: string;
  initial: string;
  onSaved: (notes: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValue = useRef(initial);

  // Reset when switching projects (initial is the project's stored notes).
  useEffect(() => {
    setValue(initial);
    lastValue.current = initial;
    setSavedAt(null);
  }, [initial]);

  // Debounced autosave. The textarea is the source of truth; we PATCH
  // only when the user pauses for 800ms and the content actually
  // changed since the last save.
  useEffect(() => {
    if (value === lastValue.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const updated = await updateProject(projectId, {
          notes: value || null,
        });
        lastValue.current = value;
        setSavedAt(new Date());
        onSaved(updated.notes);
      } catch {
        // Stay quiet — autosave failures are recoverable on the next
        // keystroke. Any persistent error will still surface via the
        // backing API responses.
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, projectId, onSaved]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex shrink-0 items-center justify-between">
        <p className="text-[11px] text-muted-foreground/70">
          Free-form notes for this project. Markdown is rendered when you
          read; the editor here is plain text.
        </p>
        <span className="text-[11px] text-muted-foreground/60">
          {saving
            ? "Saving…"
            : savedAt
              ? `Saved ${formatRelative(savedAt.toISOString())}`
              : ""}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`# Open questions\n\n- Why does X work?\n- Is the result in [paper 2] consistent with [paper 4]?\n\n# Methods compared\n\n…`}
        className="flex min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none transition focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/40"
        spellCheck
      />
    </div>
  );
}

function DeleteConfirm({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-background p-4 ring-1 ring-foreground/10"
      >
        <p className="text-[14px] font-semibold text-foreground">
          Delete project?
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          “{name}” will be removed. The reviews inside it stay — only the
          project grouping (and its notes / chat history) is deleted.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Delete project
          </Button>
        </div>
      </div>
    </div>
  );
}
