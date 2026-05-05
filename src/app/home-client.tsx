"use client";

import { ArrowRight, FileText, Terminal, FileDown } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { useState } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import ImportBundleDialog from "@/components/import-bundle-dialog";
import { ItalicAccent, MonoLabel } from "@/components/folio";
import { useRouter } from "next/navigation";

interface Lane {
  icon: typeof FileText;
  title: string;
  body: string;
  onClick: () => void;
}

export default function HomeClient() {
  const [showNewReview, setShowNewReview] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const router = useRouter();

  const lanes: Lane[] = [
    {
      icon: FileText,
      title: "Read a paper",
      body: "Paste an arXiv link, upload a PDF, or open any web page. Highlight passages and chat with an assistant grounded in the text.",
      onClick: () => setShowNewReview(true),
    },
    {
      icon: Terminal,
      title: "Import from Claude Code",
      body: "Turn coding sessions into journal entries. Daily recaps and weekly digests are generated from your activity.",
      onClick: () => router.push("/journal"),
    },
    {
      icon: FileDown,
      title: "Open a shared review",
      body: "Continue from a colleague's bundle. Annotations, notes, and chat history all come along.",
      onClick: () => setShowImport(true),
    },
  ];

  return (
    <DashboardLayout>
      <div
        className="relative flex h-full flex-col overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
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

        <div className="mx-auto w-full max-w-[680px] px-8 pt-[min(14vh,128px)] pb-16">
          <MonoLabel>Today</MonoLabel>
          <h1
            className="mt-4 text-[40px] font-bold leading-[1.02] tracking-[-0.035em] text-foreground"
            style={{ textWrap: "balance" }}
          >
            What are you working on{" "}
            <ItalicAccent>today?</ItalicAccent>
          </h1>
          <p
            className="mt-4 max-w-[520px] text-[15.5px] leading-[1.65]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 75%, transparent)",
              textWrap: "pretty",
            }}
          >
            Pick a starting point. Everything you do builds your journal in
            the background.
          </p>

          <div className="mt-10 flex flex-col gap-2.5">
            {lanes.map((lane) => (
              <Lane key={lane.title} lane={lane} />
            ))}
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

function Lane({ lane }: { lane: Lane }) {
  const Icon = lane.icon;
  return (
    <button
      type="button"
      onClick={lane.onClick}
      className="group flex w-full items-start gap-4 rounded-lg border bg-card px-5 py-4 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/30 hover:shadow-[var(--shadow-sm)]"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 75%, transparent)",
      }}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--badge-accent-bg)" }}
      >
        <Icon
          className="size-[16px]"
          style={{
            color: "color-mix(in srgb, var(--primary) 75%, transparent)",
          }}
          strokeWidth={1.6}
        />
      </div>
      <div className="min-w-0 flex-1 pt-px">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.012em] text-foreground">
            {lane.title}
          </h3>
          <ArrowRight className="size-3.5 text-muted-foreground/40 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-primary/70" />
        </div>
        <p
          className="mt-1 max-w-[460px] text-[13px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 68%, transparent)",
          }}
        >
          {lane.body}
        </p>
      </div>
    </button>
  );
}
