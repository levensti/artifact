"use client";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/dashboard-layout";
import ResearchComposer from "@/components/research-composer";
import { useSettingsOpener } from "@/components/settings-opener-context";
import { createProject, hydrateClientStore } from "@/lib/client-data";
import { hasUsableProvider } from "@/lib/keys";
import { setPendingResearch } from "@/lib/pending-research";
import { KEYS_UPDATED_EVENT } from "@/lib/storage-events";

export default function HomeClient() {
  // SettingsOpenerProvider is mounted *inside* DashboardLayout, so any hook
  // that touches that context (useSettingsOpener) has to live in a child
  // component rendered as a descendant. Splitting the body keeps the hook
  // call below the provider in the React tree.
  return (
    <DashboardLayout>
      <HomeBody />
    </DashboardLayout>
  );
}

/** Longest project name derived from a question, before it's cut at a word. */
const PROJECT_NAME_MAX = 60;

/** A project name from a research question: the question itself, cut at a
 *  word boundary when long, without a trailing question mark. */
function projectNameFrom(question: string): string {
  const text = question
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/, "");
  if (text.length <= PROJECT_NAME_MAX) return text;
  const cut = text.slice(0, PROJECT_NAME_MAX);
  const atWord = cut.slice(0, cut.lastIndexOf(" ")) || cut;
  return `${atWord}…`;
}

/**
 * Home is a single prompt: ask what you want to learn. Every brief lives in
 * a project, so submitting creates one named from the question, hands the
 * question off, and navigates there, where the brief streams in and is saved.
 */
function HomeBody() {
  const router = useRouter();
  const { openSettings } = useSettingsOpener();
  const [hydrated, setHydrated] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = () => setModelReady(hasUsableProvider());
    void (async () => {
      try {
        await hydrateClientStore();
        if (!cancelled) sync();
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(KEYS_UPDATED_EVENT, sync);
    };
  }, []);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const handleSubmit = useCallback(
    (text: string) => {
      if (!hydrated || starting) return;
      if (!modelReady) {
        openSettings();
        return;
      }
      setStarting(true);
      setStartError(null);
      void createProject(projectNameFrom(text))
        .then((project) => {
          setPendingResearch(text);
          router.push(`/projects/${project.id}`);
        })
        .catch((err) => {
          setStartError(
            err instanceof Error ? err.message : "Couldn't start the research.",
          );
          setStarting(false);
        });
    },
    [hydrated, starting, modelReady, openSettings, router],
  );

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "var(--reader-mat)" }}
    >
      {/* One job, so the prompt sits in the middle of the page, lifted a
          little above true center where the eye lands. */}
      <div className="mx-auto flex min-h-full w-full max-w-160 flex-col justify-center gap-5 px-6 pb-[14vh] pt-12 sm:px-8">
        <div className="text-center">
          <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.022em] text-foreground">
            What do you want to explore?
          </h1>
          <p className="mt-1.5 text-[15px] leading-[1.6] text-muted-foreground">
            Artifact will curate a personalized reading list to help you become
            an expert.
          </p>
        </div>

        <ResearchComposer
          disabled={(hydrated && !modelReady) || starting}
          isStreaming={starting}
          hint={
            !hydrated || modelReady
              ? "e.g. How have attention mechanisms evolved over time?"
              : "Add a Fireworks API key in Settings to start"
          }
          onSubmit={handleSubmit}
          autoFocus
        />

        {startError ? (
          <p className="text-[13px] text-destructive">{startError}</p>
        ) : null}

        {hydrated && !modelReady ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="flex items-start gap-3">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-primary/80"
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                <p className="font-medium text-foreground">
                  Add an API key to start
                </p>
                <p className="text-muted-foreground">
                  Research uses the same Fireworks key as the rest of Artifact.
                  Add one in{" "}
                  <button
                    type="button"
                    onClick={() => openSettings()}
                    className="underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                  >
                    settings
                  </button>{" "}
                  to begin.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
