"use client";

import { ArrowRight, FileText, KeyRound, Terminal } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { useState, useSyncExternalStore } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import { ItalicAccent, MonoLabel } from "@/components/folio";
import { useSettingsOpener } from "@/components/settings-opener-context";
import { hasAnySavedApiKey } from "@/lib/keys";
import { KEYS_UPDATED_EVENT } from "@/lib/storage-events";
import { useRouter } from "next/navigation";

interface Lane {
  icon: typeof FileText;
  title: string;
  body: string;
  onClick: () => void;
}

function subscribeKeys(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(KEYS_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(KEYS_UPDATED_EVENT, onChange);
}
function keysSnapshot() {
  return hasAnySavedApiKey() ? "1" : "0";
}
function keysServerSnapshot() {
  return "0";
}

export default function HomeClient() {
  const [showNewReview, setShowNewReview] = useState(false);
  const router = useRouter();
  const { openSettings } = useSettingsOpener();
  const keysFlag = useSyncExternalStore(
    subscribeKeys,
    keysSnapshot,
    keysServerSnapshot,
  );
  const hasKeys = keysFlag === "1";

  const lanes: Lane[] = [
    {
      icon: FileText,
      title: "Read a paper",
      body: "Paste an arXiv link, upload a PDF, or open any web page. Highlight passages and chat with an assistant grounded in the text.",
      onClick: () => setShowNewReview(true),
    },
    {
      icon: Terminal,
      title: "Import a session from Claude Code",
      body: "Distill your prior chat histories into focused journal entries.",
      onClick: () => router.push("/journal"),
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

        <div className="mx-auto w-full max-w-170 px-8 pt-[min(14vh,128px)] pb-16">
          <MonoLabel>Today</MonoLabel>
          <h1
            className="mt-4 text-[40px] font-bold leading-[1.02] tracking-[-0.035em] text-foreground"
            style={{ textWrap: "balance" }}
          >
            What would you like to work on{" "}
            <ItalicAccent>today?</ItalicAccent>
          </h1>

          {!hasKeys ? (
            <SetupCallout onOpenSettings={openSettings} />
          ) : null}

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
    </DashboardLayout>
  );
}

function SetupCallout({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div
      role="status"
      className="mt-9 flex flex-col gap-3 rounded-lg border bg-card px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
      style={{
        borderColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
        background:
          "color-mix(in srgb, var(--primary) 4%, var(--card))",
      }}
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--badge-accent-bg)" }}
      >
        <KeyRound
          className="size-[18px]"
          strokeWidth={1.6}
          style={{
            color: "color-mix(in srgb, var(--primary) 75%, transparent)",
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <MonoLabel tone="accent">One-time setup</MonoLabel>
        </div>
        <p
          className="mt-1.5 text-[14px] font-semibold tracking-[-0.005em] text-foreground"
        >
          Connect an AI provider to start chatting.
        </p>
        <p
          className="mt-1 text-[12.5px] leading-[1.55]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
          }}
        >
          Bring your own keys for Anthropic, OpenAI, xAI, or any
          OpenAI-compatible endpoint. Or run inference locally with Ollama,
          LM Studio, or llama.cpp.
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpenSettings()}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px sm:self-auto"
      >
        Add a key
        <ArrowRight className="size-3.5" strokeWidth={2} />
      </button>
    </div>
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
