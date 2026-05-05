import { MonoLabel } from "@/components/folio";

export interface LandingCodaProps {
  githubUrl: string;
}

export function LandingCoda({ githubUrl }: LandingCodaProps) {
  return (
    <section id="open-source" className="pt-14 pb-6">
      <div className="landing-spread">
        <aside className="landing-marg">
          <MonoLabel>Open source</MonoLabel>
        </aside>
        <div>
          <div
            className="grid max-w-[760px] grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl border bg-card px-9 py-8 sm:grid-cols-[1fr_auto]"
            style={{
              borderColor:
                "color-mix(in srgb, var(--border) 80%, transparent)",
            }}
          >
            <div>
              <h4
                className="m-0 text-[20px] tracking-[-0.018em] text-foreground"
                style={{ fontFamily: "var(--font-sans)", fontWeight: 650 }}
              >
                MIT-licensed. Yours to fork.
              </h4>
              <p
                className="mt-2 max-w-[460px] text-[15px] leading-[1.6]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color: "color-mix(in srgb, var(--foreground) 75%, transparent)",
                }}
              >
                Read the code, run it locally, file an issue, send a patch.
                Artifact is built in the open at{" "}
                <span className="ds-mono">levensti/artifact</span>.
              </p>
            </div>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center gap-2 self-start rounded-md border border-border bg-transparent px-[18px] text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted sm:self-auto"
            >
              <GithubMark className="size-[13px]" />
              View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M8 0.5C3.9 0.5 0.5 3.9 0.5 8c0 3.3 2.1 6.1 5.1 7.1.4.1.5-.2.5-.4v-1.3c-2.1.4-2.6-.9-2.6-.9-.3-.9-.8-1.1-.8-1.1-.7-.5.1-.5.1-.5.7.1 1.1.8 1.1.8.7 1.2 1.8.9 2.3.6.1-.5.3-.9.5-1.1-1.7-.2-3.4-.8-3.4-3.7 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2.1 0 0 .6-.2 2.1.8.6-.2 1.3-.3 2-.3.7 0 1.4.1 2 .3 1.5-1 2.1-.8 2.1-.8.4 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2 0 2.9-1.7 3.5-3.4 3.7.3.2.5.7.5 1.4v2c0 .2.1.5.6.4 3-1 5.1-3.8 5.1-7.1C15.5 3.9 12.1 0.5 8 0.5z" />
    </svg>
  );
}
