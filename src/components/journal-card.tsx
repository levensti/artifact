"use client";

import { BookMarked, Sparkles } from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { cn } from "@/lib/utils";

export interface JournalEntry {
  kind: "session" | "digest";
  page: WikiPage;
  date: Date;
}

interface JournalCardProps {
  entry: JournalEntry;
  onOpen: (slug: string) => void;
}

function firstParagraph(md: string): string {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    if (t.startsWith(">")) return t.replace(/^>\s*/, "").slice(0, 220);
    return t.slice(0, 220);
  }
  return "";
}

function countSections(md: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let current: string | null = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1].toLowerCase();
      counts[current] = 0;
      continue;
    }
    if (current && /^\s*-\s+/.test(line)) {
      counts[current] = (counts[current] ?? 0) + 1;
    }
  }
  return counts;
}

function sessionChips(content: string): Array<{ label: string; count: number }> {
  const counts = countSections(content);
  const chips: Array<{ label: string; count: number }> = [];
  const papers = counts["papers"] ?? 0;
  const moments = counts["moments"] ?? 0;
  const questions = counts["open questions"] ?? 0;
  if (papers)
    chips.push({ label: papers === 1 ? "paper" : "papers", count: papers });
  if (moments) chips.push({ label: "moments", count: moments });
  if (questions)
    chips.push({
      label: questions === 1 ? "question" : "questions",
      count: questions,
    });
  return chips;
}

function relativeDateLabel(d: Date): string {
  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function JournalCard({ entry, onOpen }: JournalCardProps) {
  const isDigest = entry.kind === "digest";
  const excerpt = firstParagraph(entry.page.content);
  const chips = isDigest ? [] : sessionChips(entry.page.content);
  const dateLabel = relativeDateLabel(entry.date);
  const Icon = isDigest ? Sparkles : BookMarked;
  const typeLabel = isDigest ? "Digest" : "Session";

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.page.slug)}
      className={cn(
        "group flex w-full flex-col rounded-xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-all duration-200",
        "hover:border-primary/30 hover:shadow-md hover:shadow-primary/8 hover:-translate-y-px",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon
            className={cn(
              "size-3",
              isDigest ? "text-warning/60" : "text-primary/50",
            )}
            strokeWidth={1.8}
          />
          <span className="text-[10.5px] font-medium text-muted-foreground/60">
            {typeLabel}
          </span>
        </div>
        <span className="text-[10.5px] tabular-nums text-muted-foreground/45">
          {dateLabel}
        </span>
      </div>

      <h3 className="mt-2 line-clamp-2 h-[37px] text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground/85 transition-colors group-hover:text-foreground">
        {entry.page.title}
      </h3>

      <p className="mt-1.5 line-clamp-2 h-[37px] text-[12px] leading-[1.55] text-muted-foreground/55">
        {excerpt}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 border-t border-border/40 pt-2.5 text-[10.5px] text-muted-foreground/50 min-h-[28px]">
        {chips.length > 0
          ? chips.map((c, i) => (
              <span key={c.label} className="tabular-nums">
                {i > 0 ? <span className="mr-2.5 opacity-30">·</span> : null}
                <span className="font-semibold text-foreground/60">
                  {c.count}
                </span>{" "}
                {c.label}
              </span>
            ))
          : <span className="text-muted-foreground/30">{isDigest ? "Weekly digest" : "Session"}</span>}
      </div>
    </button>
  );
}
