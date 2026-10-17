"use client";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/dashboard-layout";
import ResearchComposer from "@/components/research-composer";
import { useSettingsOpener } from "@/components/settings-opener-context";
import { hydrateClientStore } from "@/lib/client-data";
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

/**
 * Home is a single prompt: ask what you want to learn. The research run
 * itself lives on Artifacts, so submitting hands the question off and
 * navigates there, where the brief streams in and is saved.
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

  const handleSubmit = useCallback(
    (text: string) => {
      if (!hydrated) return;
      if (!modelReady) {
        openSettings();
        return;
      }
      setPendingResearch(text);
      router.push("/artifacts");
    },
    [hydrated, modelReady, openSettings, router],
  );

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "var(--reader-mat)" }}
    >
      {/* Same content column as Artifacts/Journal so navigating between pages
          doesn't reflow the layout. */}
      <div className="mx-auto w-full max-w-4xl space-y-5 px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
        {/* Title mirrors the shared PageHeader (size, weight, and top
            position) so navigating between pages doesn't shift the header. */}
        <div>
          <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.022em] text-foreground">
            What do you want to explore?
          </h1>
          <p className="mt-1.5 max-w-150 text-[15px] leading-[1.6] text-muted-foreground">
            Not sure which exact paper or resource to read? Ask about a topic,
            method, or open question. Artifact will help find the best resources
            and write a short brief with a ranked reading list.
          </p>
        </div>

        <ResearchComposer
          disabled={hydrated && !modelReady}
          isStreaming={false}
          hint={
            !hydrated || modelReady
              ? "e.g. How have attention mechanisms evolved over time?"
              : "Add a Fireworks API key in Settings to start"
          }
          onSubmit={handleSubmit}
          autoFocus
        />

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
