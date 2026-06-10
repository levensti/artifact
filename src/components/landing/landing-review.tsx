import { SectionHeader } from "@/components/landing/landing-section";

/**
 * Review — highlight a passage, get a thread anchored to it. Mock on the
 * left, copy on the right (mirrors the Discover band's composition).
 */
export function LandingReview() {
  return (
    <section id="review" className="bg-background">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-x-16 gap-y-12 px-6 py-20 sm:py-24 md:px-10 lg:grid-cols-[6fr_5fr]">
        <div className="order-2 lg:order-1">
          <HighlightThread />
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeader
            num="02"
            kicker="Review"
            title="Highlight a sentence. Ask about it."
            lede="The assistant has the full text in context. Ask for a derivation, pull definitions side-by-side, or highlight any passage to open a thread that stays pinned to it. Every answer cites its source — click the chip, land on the passage."
          />
        </div>
      </div>
    </section>
  );
}

function HighlightThread() {
  return (
    <div className="relative">
      {/* The passage being read */}
      <div
        className="rounded-lg border bg-card px-6 py-5 sm:px-7 sm:py-6"
        style={{
          borderColor: "color-mix(in srgb, var(--border) 90%, transparent)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div
          className="mb-3 font-mono text-[9.5px] uppercase"
          style={{
            letterSpacing: "0.08em",
            color:
              "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
          }}
        >
          Toolformer · p. 3 · §2.1
        </div>
        <p
          className="m-0 text-[14px] leading-[1.75]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 90%, transparent)",
          }}
        >
          Given just a handful of human-written examples of how an API can be
          used,{" "}
          <span className="landing-hl-blue">
            we let the model annotate a large language-modeling dataset with
            potential API calls
          </span>
          . We then use a self-supervised loss to determine which of these
          calls actually help the model predict future tokens.
        </p>
      </div>

      {/* The thread, anchored to the highlight */}
      <div
        className="relative ml-6 mr-2 -mt-2.5 rounded-lg border bg-card p-4 sm:ml-12 sm:mr-6"
        style={{
          borderColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
          boxShadow: "var(--shadow-primary), var(--shadow-md)",
        }}
      >
        <span
          className="absolute -top-2 left-7 size-3.5 rotate-45 border-l border-t bg-card"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
          }}
          aria-hidden
        />
        <div
          className="flex items-center gap-2 font-mono text-[9.5px] uppercase"
          style={{
            letterSpacing: "0.1em",
            color: "color-mix(in srgb, var(--primary) 75%, transparent)",
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: "var(--primary)" }}
            aria-hidden
          />
          Thread on this highlight
        </div>

        <div
          className="mt-3 ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 font-sans text-[12px] leading-[1.5]"
          style={{
            background: "color-mix(in srgb, var(--primary) 9%, transparent)",
            color: "color-mix(in srgb, var(--foreground) 92%, transparent)",
          }}
        >
          Isn&apos;t this just distillation from the API responses?
        </div>

        <div
          className="mt-2.5 max-w-[92%] rounded-lg rounded-bl-sm border px-3.5 py-3 text-[12px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
            background:
              "color-mix(in srgb, var(--reader-mat) 60%, var(--card))",
            color: "color-mix(in srgb, var(--foreground) 88%, transparent)",
          }}
        >
          Not quite — the filter keeps an API call only if it lowers
          perplexity on the <em>following</em> tokens{" "}
          <InlineChip>Eq. 4</InlineChip>, so the supervision signal is the
          model&apos;s own future predictions, not the API output itself.
        </div>
      </div>
    </div>
  );
}

function InlineChip({ children }: { children: React.ReactNode }) {
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
