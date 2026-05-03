const TITLES = [
  "Attention Is All You Need",
  "Denoising Diffusion Probabilistic Models",
  "Language Models are Few-Shot Learners",
  "Neural Ordinary Differential Equations",
  "Mixture-of-Experts",
  "Direct Preference Optimization",
  "Mamba: Linear-Time Sequence Modeling",
  "AlphaFold 2",
  "An Image is Worth 16×16 Words",
  "Chain-of-Thought Prompting",
  "Constitutional AI",
  "FlashAttention",
];

export function LandingMarquee() {
  // Repeat the list so the keyframe can translate -50% for a seamless loop.
  const loop = [...TITLES, ...TITLES];
  return (
    <section
      aria-hidden
      className="landing-marquee relative overflow-hidden border-y border-border/60 bg-muted/30"
    >
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />

      <div className="flex items-center gap-3 px-6 py-3.5">
        <span className="shrink-0 text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground/80 uppercase">
          Recently studied
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div className="landing-marquee-track flex w-max gap-10 whitespace-nowrap will-change-transform">
            {loop.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="inline-flex items-center gap-3 text-[12.5px] text-muted-foreground"
              >
                <span className="text-foreground/70">{t}</span>
                <span className="text-muted-foreground/40">·</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
