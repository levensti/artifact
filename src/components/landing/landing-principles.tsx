import { MonoLabel } from "@/components/folio";

interface Principle {
  title: string;
  body: string;
}

const PRINCIPLES: Principle[] = [
  {
    title: "Open source, MIT-licensed",
    body: "Read the code, run it yourself, fork it, send a patch. Sign in with Google at withartifact.com to use the hosted version free, or self-host the whole thing.",
  },
  {
    title: "Bring your own keys",
    body: "Use Anthropic, OpenAI, xAI, or any OpenAI-compatible provider: OpenRouter, Fireworks, Together. Or run inference locally with Ollama, LM Studio, or llama.cpp.",
  },
  {
    title: "Trust every answer",
    body: "Click any citation chip to jump straight to the passage. Every answer your assistant gives traces back to where it came from in the PDF or page.",
  },
  {
    title: "Read for hours",
    body: "Warm neutrals, a single restrained accent, Inter for prose. Designed for long sessions. No pitching, no scroll-baiting, no interruptions.",
  },
];

export function LandingPrinciples() {
  return (
    <section id="principles" className="py-14">
      <div className="landing-spread">
        <aside className="landing-marg">
          <MonoLabel>Principles</MonoLabel>
        </aside>
        <div>
          <h2 className="landing-section-title">
            Free, open source,
            <br />
            and yours to fork.
          </h2>
          <p
            className="mt-[18px] max-w-[620px] text-[17px] leading-[1.65]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
              textWrap: "pretty",
            }}
          >
            Read the code. Self-host it, or use the free hosted version. Bring
            your own AI keys, or point it at a local model. Trust every answer,
            because every answer cites the source.
          </p>

          <div className="mt-9 grid max-w-[760px] grid-cols-1 gap-x-14 gap-y-9 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div key={p.title}>
                <h4
                  className="text-[16px] font-semibold tracking-[-0.012em] text-foreground"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {p.title}
                </h4>
                <p
                  className="mt-2 text-[14.5px] leading-[1.6]"
                  style={{
                    fontFamily: "var(--font-reading)",
                    color:
                      "color-mix(in srgb, var(--foreground) 75%, transparent)",
                  }}
                >
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
