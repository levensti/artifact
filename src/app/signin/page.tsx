import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth";

interface PageProps {
  searchParams: Promise<{ mode?: string; callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth();
  const { mode, callbackUrl } = await searchParams;
  if (session?.user) {
    redirect(callbackUrl ?? "/");
  }

  const isSignup = mode === "signup";
  const target = callbackUrl ?? "/";

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <BrandPanel />
      <section className="flex items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-[360px]">
          <header className="mb-9">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {isSignup
                ? "Sign up with Google to start annotating papers and journaling your research."
                : "Sign in with Google to continue your research."}
            </p>
          </header>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: target });
            }}
          >
            <button
              type="submit"
              className="group flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground/90 shadow-[var(--shadow-sm)] transition-all duration-150 hover:border-primary/30 hover:shadow-[var(--shadow-primary)] hover:-translate-y-px active:translate-y-0"
            >
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
          </form>

          <div className="my-7 flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60">
            <span className="h-px flex-1 bg-border" />
            <span>or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <p className="text-center text-[12.5px] text-muted-foreground">
            {isSignup ? "Already have an account?" : "New to Artifact?"}{" "}
            <Link
              href={
                isSignup
                  ? `/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`
                  : `/signin?mode=signup${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`
              }
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>

          <p className="mt-12 text-center text-[11px] leading-relaxed text-muted-foreground/60">
            By continuing, you agree to our terms and acknowledge our privacy
            policy. We use your Google account only to identify you.
          </p>
        </div>
      </section>
    </main>
  );
}

function BrandPanel() {
  return (
    <section className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
      {/* Soft watermark */}
      <svg
        viewBox="4 4 24 24"
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-[460px] opacity-[0.07]"
      >
        <path
          d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
          fill="currentColor"
        />
        <circle cx="22" cy="10" r="3.2" fill="currentColor" />
      </svg>
      {/* Subtle gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_85%,rgba(255,255,255,0.08),transparent_55%)]"
      />

      <header className="relative flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[8px] bg-primary-foreground/10 backdrop-blur-sm">
          <svg viewBox="4 4 24 24" aria-hidden className="size-[18px]">
            <path
              d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
              fill="currentColor"
              opacity="0.4"
            />
            <circle cx="22" cy="10" r="3.2" fill="currentColor" />
          </svg>
        </span>
        <span className="text-[16px] font-semibold tracking-[-0.025em]">
          Artifact
        </span>
      </header>

      <div className="relative max-w-105">
        <h2 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em]">
          Discover the research frontier.
        </h2>
        <p className="mt-5 text-[14px] leading-relaxed text-primary-foreground/70">
          Annotate papers, chat with an AI research assistant, and let your
          journal write itself from what you actually read.
        </p>
      </div>

      <footer className="relative text-[11.5px] text-primary-foreground/55">
        © {new Date().getFullYear()} Artifact
      </footer>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      className="size-[16px] transition-transform duration-150 group-hover:scale-105"
    >
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </svg>
  );
}
