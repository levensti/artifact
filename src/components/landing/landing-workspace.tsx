import { MonoLabel } from "@/components/folio";

/**
 * The hero centerpiece — a believable miniature of the review workspace,
 * built out of the app's real tokens instead of a screenshot: assistant
 * chat on the left, the paper on the reader mat in the middle, the notes
 * rail on the right. Side panes collapse away on narrow viewports so the
 * paper always stays the star.
 */
export function LandingWorkspace() {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card text-left"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 90%, transparent)",
        boxShadow:
          "var(--shadow-lg), 0 30px 80px -20px color-mix(in srgb, var(--primary) 22%, transparent)",
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5"
        style={{
          borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
          background: "color-mix(in srgb, var(--reader-mat) 55%, var(--card))",
        }}
      >
        <span className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-[9px] rounded-full"
              style={{
                background: "color-mix(in srgb, var(--border) 140%, transparent)",
              }}
            />
          ))}
        </span>
        <span
          className="hidden font-mono text-[11px] sm:inline"
          style={{
            letterSpacing: "0.04em",
            color: "var(--muted-foreground)",
          }}
        >
          SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-sans text-[10.5px] font-medium"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 90%, transparent)",
            color: "var(--muted-foreground)",
          }}
        >
          <ShareGlyph />
          Share
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] xl:grid-cols-[270px_1fr_232px]">
        {/* Assistant rail */}
        <aside
          className="hidden flex-col gap-3 border-r p-4 lg:flex"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
            background: "var(--sidebar)",
          }}
        >
          <MonoLabel>Assistant</MonoLabel>

          <div
            className="self-end rounded-lg rounded-br-sm px-3 py-2 font-sans text-[11.5px] leading-[1.5]"
            style={{
              background: "color-mix(in srgb, var(--primary) 9%, transparent)",
              color: "color-mix(in srgb, var(--foreground) 92%, transparent)",
              maxWidth: "92%",
            }}
          >
            Why does the resolve rate collapse on repos outside the top four?
          </div>

          <div
            className="rounded-lg rounded-bl-sm border px-3 py-2.5 text-[11.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
              background: "var(--card)",
              color: "color-mix(in srgb, var(--foreground) 88%, transparent)",
            }}
          >
            Mostly long-tail context: those repos average 2.6× more files
            touched per gold patch <Chip>§4.2</Chip> and the issue text is
            sparser <Chip>Tab. 3</Chip>. The authors call this out as the
            hardest split.
          </div>

          <div
            className="mt-auto flex items-center gap-2 rounded-md border px-2.5 py-2 font-sans text-[11px]"
            style={{
              borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
              background: "var(--card)",
              color:
                "color-mix(in srgb, var(--muted-foreground) 85%, transparent)",
            }}
          >
            Ask about this paper…
            <span className="landing-caret" aria-hidden />
          </div>
        </aside>

        {/* The paper, on the reader mat */}
        <div
          className="p-4 sm:p-6"
          style={{ background: "var(--reader-mat)" }}
        >
          <div
            className="mx-auto max-w-[560px] rounded-md border bg-background px-6 py-6 sm:px-8 sm:py-7"
            style={{
              borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <div
              className="font-mono text-[9.5px] uppercase"
              style={{
                letterSpacing: "0.08em",
                color:
                  "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
              }}
            >
              arXiv:2310.06770 · cs.CL · Oct 2023
            </div>
            <h3
              className="mt-2.5 font-sans text-[17px] font-semibold leading-[1.3] tracking-[-0.018em] text-foreground"
              style={{ textWrap: "balance" }}
            >
              SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
            </h3>
            <div
              className="mt-1.5 font-mono text-[10px]"
              style={{
                letterSpacing: "0.05em",
                color:
                  "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
              }}
            >
              JIMENEZ · YANG · WETTIG · YAO · PEI · PRESS · NARASIMHAN
            </div>
            <p
              className="mt-4 text-[13px] leading-[1.75]"
              style={{
                fontFamily: "var(--font-reading)",
                color: "color-mix(in srgb, var(--foreground) 90%, transparent)",
              }}
            >
              SWE-bench evaluates language models on{" "}
              <span className="landing-hl-blue">
                2,294 software-engineering problems drawn from real GitHub
                issues
                <ThreadPill>thread · 4</ThreadPill>
              </span>{" "}
              and corresponding pull requests across 12 popular Python
              repositories. Given a codebase and an issue, a model is tasked
              with{" "}
              <span className="landing-hl">
                generating a patch that resolves the described problem
              </span>
              . Resolving issues requires understanding and coordinating
              changes across multiple functions, classes, and files
              simultaneously.
            </p>
            <p
              className="mt-3 text-[13px] leading-[1.75]"
              style={{
                fontFamily: "var(--font-reading)",
                color: "color-mix(in srgb, var(--foreground) 62%, transparent)",
              }}
            >
              Our evaluations show that both state-of-the-art proprietary
              models and our fine-tuned model SWE-Llama can resolve only the
              simplest issues…
            </p>
          </div>
        </div>

        {/* Notes rail */}
        <aside
          className="hidden flex-col gap-3 border-l p-4 xl:flex"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
            background: "var(--sidebar)",
          }}
        >
          <MonoLabel>Notes</MonoLabel>

          <NoteCard tag="p. 2 · margin note">
            The contamination story feels optimistic — new issues leak into
            pretraining faster than they assume.
          </NoteCard>

          <NoteCard tag="p. 4 · open question" accent>
            Is patch-level evaluation too coarse to credit partial fixes?
          </NoteCard>

          <div
            className="mt-auto rounded-md border border-dashed px-2.5 py-2 font-sans text-[10.5px]"
            style={{
              borderColor: "color-mix(in srgb, var(--border) 130%, transparent)",
              color:
                "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
            }}
          >
            Highlight a passage to pin a note…
          </div>
        </aside>
      </div>
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden
    >
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="3.5" r="2" />
      <circle cx="12" cy="12.5" r="2" />
      <path d="M5.7 7.1l4.6-2.7M5.7 8.9l4.6 2.7" />
    </svg>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mx-0.5 inline-block rounded px-1 font-sans text-[10px] font-medium"
      style={{
        border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
        background: "color-mix(in srgb, var(--primary) 6%, transparent)",
        color: "color-mix(in srgb, var(--primary) 90%, var(--foreground))",
        transform: "translateY(-0.5px)",
      }}
    >
      {children}
    </span>
  );
}

function ThreadPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 align-middle font-sans text-[10px] font-medium"
      style={{
        background: "var(--badge-accent-bg)",
        color: "var(--badge-accent-fg)",
        transform: "translateY(-1px)",
      }}
    >
      <span
        className="size-1 rounded-full"
        style={{ background: "var(--primary)" }}
        aria-hidden
      />
      {children}
    </span>
  );
}

function NoteCard({
  tag,
  accent,
  children,
}: {
  tag: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        background: accent
          ? "color-mix(in srgb, var(--primary) 4%, var(--card))"
          : "var(--card)",
        borderColor: accent
          ? "color-mix(in srgb, var(--primary) 20%, transparent)"
          : "color-mix(in srgb, var(--border) 80%, transparent)",
      }}
    >
      <div
        className="font-mono text-[9px] uppercase"
        style={{
          letterSpacing: "0.1em",
          color: accent
            ? "color-mix(in srgb, var(--primary) 75%, transparent)"
            : "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
        }}
      >
        {tag}
      </div>
      <p
        className="mt-1.5 mb-0 text-[11px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-reading)",
          fontStyle: "italic",
          color: "color-mix(in srgb, var(--foreground) 78%, transparent)",
        }}
      >
        {children}
      </p>
    </div>
  );
}
