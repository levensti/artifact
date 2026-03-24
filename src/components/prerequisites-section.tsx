"use client";

import { BookOpen, Check, Circle, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Prerequisite } from "@/lib/explore";

interface PrerequisitesSectionProps {
  prerequisites: Prerequisite[];
  loadingTopicId: string | null;
  onOpenStudy: (item: Prerequisite) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onAskAbout?: (topic: string) => void;
}

const DIFFICULTY_STYLE: Record<Prerequisite["difficulty"], string> = {
  foundational: "bg-emerald-100/50 text-emerald-900 border-emerald-300/70",
  intermediate: "bg-amber-100/50 text-amber-900 border-amber-300/70",
  advanced: "bg-rose-100/45 text-rose-900 border-rose-300/70",
};

function arxivSearchUrl(topic: string) {
  return `https://arxiv.org/search/?query=${encodeURIComponent(topic)}&searchtype=all&order=-announced_date_first`;
}

function IconButton({
  onClick,
  title,
  disabled,
  children,
  className,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "size-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function PrerequisitesSection({
  prerequisites,
  loadingTopicId,
  onOpenStudy,
  onToggleComplete,
  onAskAbout,
}: PrerequisitesSectionProps) {
  const doneCount = prerequisites.filter((p) => !!p.completedAt).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>
          <span className="font-medium text-foreground">
            {doneCount}/{prerequisites.length}
          </span>{" "}
          read
        </span>
      </div>

      <ul className="space-y-1.5">
        {prerequisites.map((item) => {
          const done = !!item.completedAt;
          const loading = loadingTopicId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                "rounded-md border border-border bg-card transition-opacity",
                done && "opacity-60",
              )}
            >
              <div className="flex items-start gap-2 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => onToggleComplete(item.id, !done)}
                  className={cn(
                    "mt-px shrink-0 rounded-md border p-0.5 transition-colors",
                    done
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/30",
                  )}
                  aria-label={done ? "Mark as not read" : "Mark as read"}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2} /> : <Circle className="size-3.5" />}
                </button>

                <div className="min-w-0 flex-1">
                  {/* Title row with difficulty badge and action icons */}
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "text-[13px] font-medium text-foreground leading-snug min-w-0 truncate",
                        done && "line-through decoration-muted-foreground/50",
                      )}
                      title={item.topic}
                    >
                      {item.topic}
                    </p>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wide shrink-0",
                        DIFFICULTY_STYLE[item.difficulty],
                      )}
                    >
                      {item.difficulty === "foundational" ? "core" : item.difficulty === "intermediate" ? "mid" : "adv"}
                    </span>
                    <div className="flex-1" />
                    {/* Inline icon actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <IconButton
                        onClick={() => onOpenStudy(item)}
                        title={loading ? "Generating…" : item.explanation ? "Open study guide" : "Generate study guide"}
                        disabled={loading}
                        className={item.explanation ? "text-primary border-primary/30" : undefined}
                      >
                        <Sparkles className="size-3.5" />
                      </IconButton>
                      {onAskAbout && (
                        <IconButton
                          onClick={() => onAskAbout(item.topic)}
                          title="Ask about this"
                        >
                          <MessageSquare className="size-3.5" />
                        </IconButton>
                      )}
                      <a href={arxivSearchUrl(item.topic)} target="_blank" rel="noreferrer">
                        <IconButton
                          onClick={() => {}}
                          title="Find papers on arXiv"
                        >
                          <BookOpen className="size-3.5" />
                        </IconButton>
                      </a>
                    </div>
                  </div>
                  {/* Description: compact, 2-line clamp */}
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                    {item.description}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
