"use client";

import { useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsOpenerOptional } from "./settings-opener-context";
import { useBraveKeyResumeOptional } from "./brave-key-resume-context";
import { hasBraveSearchApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";

/**
 * Inline card shown in the chat when the agent's `web_search` call
 * returned BRAVE_KEY_REQUIRED. Pauses the assistant turn until the user
 * either adds a key (chat resumes with web search functional) or dismisses
 * the card (chat resumes with web_search unregistered for that turn).
 *
 * The agent's loop is already broken on the server — this card is the
 * pause point. The "Add API key" button opens Settings; once the user
 * saves a key, the card detects it via KEYS_UPDATED_EVENT and triggers
 * the resume automatically.
 *
 * `queryText` overrides the resume target. The discover queue uses it on
 * post-finalize cards so the retry runs the originally-failed query, not
 * whatever the user typed since.
 */
export default function BraveKeyPromptCard({
  queryText,
}: {
  queryText?: string;
} = {}) {
  const [acted, setActed] = useState(false);
  const opener = useSettingsOpenerOptional();
  const resume = useBraveKeyResumeOptional();
  // Latch — only the first card in a message should retry; if a previous
  // sibling card already triggered a resume, we go quiet.
  const triggeredRef = useRef(false);

  // After the user clicks "Add API key" we open Settings and watch for the
  // key to actually land. As soon as a key exists, retry with web_search
  // functional. We don't peek at the value — we just trust that
  // hasBraveSearchApiKey() flipping true means the user saved one.
  const [waitingForKey, setWaitingForKey] = useState(false);
  useEffect(() => {
    if (!waitingForKey) return;
    const check = () => {
      if (hasBraveSearchApiKey() && !triggeredRef.current) {
        triggeredRef.current = true;
        setActed(true);
        resume?.resumeAfterBraveDecision({ skipWebSearch: false, text: queryText });
      }
    };
    check();
    window.addEventListener(KEYS_UPDATED_EVENT, check);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, check);
  }, [waitingForKey, resume, queryText]);

  if (acted) return null;

  const handleAddKey = () => {
    if (!opener) return;
    setWaitingForKey(true);
    opener.openSettings();
  };

  const handleDismiss = () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setActed(true);
    resume?.resumeAfterBraveDecision({ skipWebSearch: true, text: queryText });
  };

  return (
    <div
      className="my-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs"
      style={{ animation: "fadeIn 200ms ease-out" }}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary mt-0.5">
          <Globe size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-foreground/90">
            Also search the web?
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground/85">
            Add a Brave Search API key to include lab blogs and other web
            sources alongside arXiv. Free tier available — or skip and the
            agent will search arXiv only.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11.5px]"
              onClick={handleAddKey}
              disabled={!opener || waitingForKey}
            >
              {waitingForKey ? "Waiting for key…" : "Add API key"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11.5px]"
              onClick={handleDismiss}
              disabled={waitingForKey}
            >
              Search arXiv only
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
