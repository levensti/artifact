import { MonoLabel } from "@/components/folio";
import { GithubMark } from "@/components/landing/landing-icons";

export interface LandingOpenSourceProps {
  githubUrl: string;
}

interface Principle {
  title: string;
  body: string;
}

const PRINCIPLES: Principle[] = [
  {
    title: "Open source, MIT-licensed",
    body: "Read the code, run it yourself, fork it, send a patch. Use the hosted version free, or self-host the whole thing.",
  },
  {
    title: "Free usage, every day",
    body: "Every account includes a daily allowance on the house — sign in and start chatting. No key, no card, no paid tier.",
  },
  {
    title: "Bring your own key",
    body: "Need more than the free allowance? Add your own OpenRouter key and keep going on any model it offers.",
  },
  {
    title: "Trust every answer",
    body: "Every answer your assistant gives traces back to the PDF or page. Click a citation chip, land on the passage.",
  },
];

/**
 * Principles + the open-source invitation, folded into one quiet section
 * between the product story and the closing CTA band.
 */
export function LandingOpenSource({ githubUrl }: LandingOpenSourceProps) {
  return (
    <section
      id="open-source"
      className="border-t"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
        background: "var(--background)",
      }}
    >
      <div className="mx-auto max-w-[1120px] px-6 py-20 sm:py-24 md:px-10">
        <div className="grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[5fr_6fr]">
          <header>
            <MonoLabel>Principles</MonoLabel>
            <h2 className="landing-h2 mt-4">
              Free, open source,
              <br />
              and yours to fork.
            </h2>
            <p className="landing-lede mt-4 max-w-[460px]">
              Artifact is built in the open. Read the code, file an issue,
              send a patch — contributions are very much welcome.
            </p>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-7 inline-flex h-10 items-center gap-2 rounded-md border border-border bg-transparent px-[18px] text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
            >
              <GithubMark className="size-3.25" />
              View on GitHub
            </a>
          </header>

          <div className="grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2">
            {PRINCIPLES.map((p, i) => (
              <div
                key={p.title}
                className="border-t pt-4"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--border) 80%, transparent)",
                }}
              >
                <div
                  className="font-mono text-[10px]"
                  style={{
                    letterSpacing: "0.1em",
                    color:
                      "color-mix(in srgb, var(--primary) 60%, transparent)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h4 className="mt-2 font-sans text-[15px] font-semibold tracking-[-0.012em] text-foreground">
                  {p.title}
                </h4>
                <p
                  className="mt-1.5 text-[13.5px] leading-[1.6]"
                  style={{
                    fontFamily: "var(--font-reading)",
                    color:
                      "color-mix(in srgb, var(--foreground) 72%, transparent)",
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
