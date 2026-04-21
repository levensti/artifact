"use client";

import { ArrowRight, FileText, Terminal, FileDown } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { useState } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import ImportBundleDialog from "@/components/import-bundle-dialog";
import { useRouter } from "next/navigation";

export default function Home() {
  const [showNewReview, setShowNewReview] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const router = useRouter();

  return (
    <DashboardLayout>
      <div className="relative flex h-full flex-col overflow-y-auto bg-background">
        {/* Ambient watermark — the Artifact mark at large scale */}
        <svg
          viewBox="4 4 24 24"
          aria-hidden
          className="pointer-events-none absolute right-[8%] top-[12%] size-[320px] opacity-[0.025]"
        >
          <path
            d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
            fill="currentColor"
          />
          <circle cx="22" cy="10" r="3.2" fill="currentColor" />
        </svg>

        <div className="mx-auto w-full max-w-[640px] px-6 pt-[min(18vh,160px)] pb-16">
          {/* Heading */}
          <div className="mb-10">
            <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground">
              What are you working on?
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Pick a starting point — everything you do builds your journal
              automatically.
            </p>
          </div>

          {/* Action lanes */}
          <div className="flex flex-col gap-3">
            {/* Lane 1: Read a paper */}
            <button
              type="button"
              onClick={() => setShowNewReview(true)}
              className="group flex w-full items-start gap-4 rounded-xl border border-border/70 bg-card px-5 py-4 text-left transition-all duration-200 hover:border-primary/25 hover:shadow-[var(--shadow-primary)] hover:-translate-y-px active:translate-y-0 active:shadow-[var(--shadow-sm)]"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors duration-200 group-hover:bg-primary/15">
                <FileText
                  className="size-[18px] text-primary/60 transition-colors duration-200 group-hover:text-primary/80"
                  strokeWidth={1.6}
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground/90 transition-colors group-hover:text-foreground">
                    Read a paper
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary/50" />
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  Paste an arXiv link, upload a PDF, or open any web page.
                  Annotate, highlight, and chat with an AI research assistant.
                </p>
              </div>
            </button>

            {/* Lane 2: Import coding sessions */}
            <button
              type="button"
              onClick={() => router.push("/journal")}
              className="group flex w-full items-start gap-4 rounded-xl border border-border/70 bg-card px-5 py-4 text-left transition-all duration-200 hover:border-primary/25 hover:shadow-[var(--shadow-primary)] hover:-translate-y-px active:translate-y-0 active:shadow-[var(--shadow-sm)]"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors duration-200 group-hover:bg-primary/15">
                <Terminal
                  className="size-[18px] text-primary/60 transition-colors duration-200 group-hover:text-primary/80"
                  strokeWidth={1.6}
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground/90 transition-colors group-hover:text-foreground">
                    Import from Claude Code
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary/50" />
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  Turn your coding sessions into journal entries. Daily recaps
                  and weekly syntheses are generated automatically.
                </p>
              </div>
            </button>

            {/* Lane 3: Open a shared review */}
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="group flex w-full items-start gap-4 rounded-xl border border-border/70 bg-card px-5 py-4 text-left transition-all duration-200 hover:border-primary/25 hover:shadow-[var(--shadow-primary)] hover:-translate-y-px active:translate-y-0 active:shadow-[var(--shadow-sm)]"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors duration-200 group-hover:bg-primary/15">
                <FileDown
                  className="size-[18px] text-primary/60 transition-colors duration-200 group-hover:text-primary/80"
                  strokeWidth={1.6}
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground/90 transition-colors group-hover:text-foreground">
                    Open a shared review
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary/50" />
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  Continue where a collaborator left off — import a review
                  bundle with annotations, notes, and chat history.
                </p>
              </div>
            </button>
          </div>

          {/* Quiet footer hint */}
          <div className="mt-8 flex items-center gap-3 px-1">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-medium tracking-[0.08em] uppercase text-muted-foreground/35">
              Everything stays in your browser
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
        </div>
      </div>

      <NewReviewDialog
        open={showNewReview}
        onClose={() => setShowNewReview(false)}
        onCreated={(id) => {
          setShowNewReview(false);
          router.push(`/review/${id}`);
        }}
      />
      <ImportBundleDialog
        open={showImport}
        mode="review"
        onClose={() => setShowImport(false)}
      />
    </DashboardLayout>
  );
}
