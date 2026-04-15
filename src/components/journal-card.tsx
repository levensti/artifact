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
        "group flex h-[180px] w-full flex-col rounded-xl border border-border/60 bg-card p-4 text-left shadow-sm transition-all duration-200",
        "hover:border-primary/30 hover:shadow-md hover:shadow-primary/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/8 transition-colors group-hover:bg-primary/14">
            <Icon className="size-[14px] text-primary/60" strokeWidth={1.8} />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground/80">
            {typeLabel}
          </span>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground/60">
          {dateLabel}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground/85 transition-colors group-hover:text-foreground">
        {entry.page.title}
      </h3>

      <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground/75">
        {excerpt}
      </p>

      {chips.length > 0 ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2 text-[10px] text-muted-foreground/60">
          {chips.map((c, i) => (
            <span key={c.label} className="tabular-nums">
              {i > 0 ? <span className="mr-2 opacity-40">·</span> : null}
              <span className="font-semibold text-foreground/70">
                {c.count}
              </span>{" "}
              {c.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-auto" />
      )}
    </button>
  );
}
