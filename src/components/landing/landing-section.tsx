/**
 * Shared section anatomy: a numbered mono kicker, display heading, and an
 * Inter lede. `tone="ink"` renders the same anatomy on the indigo bands,
 * deriving every color from --primary-foreground.
 */
export function SectionHeader({
  num,
  kicker,
  title,
  lede,
  tone = "paper",
}: {
  num: string;
  kicker: string;
  title: React.ReactNode;
  lede: React.ReactNode;
  tone?: "paper" | "ink";
}) {
  const ink = tone === "ink";
  return (
    <header>
      <div
        className="flex items-baseline gap-2.5 font-mono text-[10.5px] uppercase"
        style={{
          letterSpacing: "0.18em",
          color: ink
            ? "color-mix(in srgb, var(--primary-foreground) 60%, transparent)"
            : "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
        }}
      >
        <span style={{ fontFeatureSettings: '"tnum"' }}>{num}</span>
        <span
          className="inline-block h-px w-5 self-center"
          style={{
            background: ink
              ? "color-mix(in srgb, var(--primary-foreground) 35%, transparent)"
              : "color-mix(in srgb, var(--primary) 45%, transparent)",
          }}
          aria-hidden
        />
        <span>{kicker}</span>
      </div>
      <h2
        className="landing-h2 mt-4"
        style={ink ? { color: "var(--primary-foreground)" } : undefined}
      >
        {title}
      </h2>
      <p
        className="landing-lede mt-4 max-w-[560px]"
        style={
          ink
            ? {
                color:
                  "color-mix(in srgb, var(--primary-foreground) 78%, transparent)",
              }
            : undefined
        }
      >
        {lede}
      </p>
    </header>
  );
}
