import { MonoLabel } from "@/components/folio";

/**
 * Ambient journal section. Shows a real-feeling daily-recap entry as the
 * concrete example of what the journal produces.
 */
export function LandingJournal() {
  return (
    <section id="journal" className="py-14">
      <div className="landing-spread">
        <aside className="landing-marg">
          <MonoLabel>The journal</MonoLabel>
          <div className="mt-4">
            <span className="landing-marg-writing">
              <span className="landing-pulse-dot" aria-hidden />
              Journaling…
            </span>
          </div>
        </aside>
        <div>
          <h2 className="landing-section-title">
            A journal that compounds
            <br />
            with you as you explore the frontier.
          </h2>
          <p
            className="mt-4.5 max-w-155 text-[17px] leading-[1.65]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
              textWrap: "pretty",
            }}
          >
            Snapshot a chat with one click. Draft an entry from your reading.
            Import a Claude Code session. Every entry compounds: concepts,
            definitions, connections you can come back to weeks, months, years
            later.
          </p>

          <div className="landing-journal-entry">
            <div
              className="font-mono text-[10.5px] uppercase"
              style={{
                letterSpacing: "0.16em",
                color:
                  "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
              }}
            >
              Today · Jan 14, 2026 · Daily recap
            </div>
            <h3
              className="mt-2.5"
              style={{
                fontFamily: "var(--font-reading)",
                fontWeight: 700,
                fontSize: "24px",
                letterSpacing: "-0.022em",
                lineHeight: 1.25,
                color: "var(--foreground)",
                textWrap: "balance",
              }}
            >
              You were thinking about retrieval as compression.
            </h3>
            <div className="body">
              <p>
                You opened{" "}
                <a href="#" className="wiki">
                  SWE-bench
                </a>{" "}
                mid-morning and spent most of the session on the methods page,
                particularly the bit about how an issue gets paired with a
                known-good patch. That argument kept coming up later, when you
                switched to{" "}
                <a href="#" className="wiki">
                  Toolformer
                </a>{" "}
                and asked your assistant whether self-supervised tool calls were
                really retrieval in disguise.
              </p>
              <p>
                The thread under the highlight on page 4 of{" "}
                <a href="#" className="wiki">
                  Reflexion
                </a>{" "}
                has three replies and is still open. I added it to the
                open-questions pile.
              </p>
              <p>
                Two new wiki pages were written this week:{" "}
                <a href="#" className="wiki">
                  Verifier-free reasoning
                </a>{" "}
                and{" "}
                <a href="#" className="wiki">
                  Patch-level evaluation
                </a>
                . They cite four sessions between them.
              </p>
            </div>
            <div
              className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-sans text-[11.5px] text-muted-foreground"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              <span>
                <Stat>4</Stat> papers
              </span>
              <span>
                <Stat>11</Stat> moments
              </span>
              <span>
                <Stat>2</Stat> open questions
              </span>
              <span>
                <Stat>2</Stat> wiki pages updated
              </span>
              <span
                style={{
                  color: "color-mix(in srgb, var(--primary) 80%, transparent)",
                }}
              >
                Editable draft
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return (
    <b
      className="font-semibold"
      style={{
        color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
      }}
    >
      {children}
    </b>
  );
}
