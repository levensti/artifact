import Link from "next/link";

export default function ShareNotFoundView() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--reader-mat)] px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-6 flex size-12 items-center justify-center rounded-2xl bg-card shadow-[var(--shadow-sm)]">
          <BrandGlyph className="size-5 text-primary" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This share isn&apos;t available
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may have been revoked, or the underlying review was deleted
          by its owner.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Go to Artifact
        </Link>
      </div>
    </main>
  );
}

function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="4 4 24 24" aria-hidden className={className}>
      <path
        d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
        fill="currentColor"
        opacity="0.4"
      />
      <circle cx="22" cy="10" r="3.2" fill="currentColor" />
    </svg>
  );
}
