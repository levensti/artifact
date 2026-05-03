import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, KeyRound, PenLine } from "lucide-react";
import { auth, signIn } from "@/server/auth";

export interface AuthPageProps {
  mode: "signin" | "signup";
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function AuthPage({ mode, searchParams }: AuthPageProps) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user) {
    redirect(callbackUrl ?? "/");
  }

  const isSignup = mode === "signup";
  const target = callbackUrl ?? "/";
  const cb =
    callbackUrl && callbackUrl !== "/"
      ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : "";

  return (
    <main className="grid min-h-screen bg-background md:grid-cols-2">
      <BrandPanel mode={mode} />
      <section className="flex items-center justify-center px-6 py-12 text-left sm:px-10">
        <div className="mx-auto w-full max-w-sm text-left">
          {/* Inline brand mark — only when the side panel is hidden */}
          <div className="mb-10 flex items-center gap-2 md:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandGlyph className="size-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">
              Artifact
            </span>
          </div>

          <header className="mb-7">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
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
              className="group flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground/90 shadow-[var(--shadow-sm)] transition-all duration-150 hover:border-primary/30 hover:shadow-[var(--shadow-primary)] hover:-translate-y-px active:translate-y-0"
            >
              <GoogleMark />
              <span>
                {isSignup ? "Sign up with Google" : "Continue with Google"}
              </span>
            </button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            {isSignup ? "Already have an account?" : "New to Artifact?"}{" "}
            <Link
              href={`${isSignup ? "/signin" : "/signup"}${cb}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>

          <p className="mt-10 text-xs leading-relaxed text-muted-foreground/55">
            By continuing, you agree to our terms and acknowledge our privacy
            policy. We use your Google account only to identify you.
          </p>
        </div>
      </section>
    </main>
  );
}

function BrandPanel({ mode }: { mode: "signin" | "signup" }) {
  const isSignup = mode === "signup";
  return (
    <section className="relative hidden overflow-hidden bg-primary text-primary-foreground md:flex md:flex-col md:justify-between md:px-12 md:py-10 lg:px-14 lg:py-12">
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_85%,rgba(255,255,255,0.08),transparent_55%)]"
      />

      <header className="relative flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10 backdrop-blur-sm">
          <BrandGlyph className="size-[18px]" />
        </span>
        <span className="text-base font-semibold tracking-tight">Artifact</span>
      </header>

      {isSignup ? <SignupPitch /> : <SigninWelcome />}

      <footer className="relative text-xs text-primary-foreground/55">
        © {new Date().getFullYear()} Artifact
      </footer>
    </section>
  );
}

function SignupPitch() {
  return (
    <div className="relative max-w-md">
      <h2 className="text-3xl font-semibold leading-tight tracking-tight">
        Discover the frontier.
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
        Pair with AI to deeply understand research papers, technical blogs, or
        anything you read.
      </p>

      <ul className="mt-9 space-y-5">
        <Feature
          icon={<BookOpen strokeWidth={1.6} className="size-3.75" />}
          title="Study anything"
        >
          A powerful assistant at your fingertips as you review arXiv papers,
          technical blogs, or your own custom content.
        </Feature>
        <Feature
          icon={<PenLine strokeWidth={1.6} className="size-3.75" />}
          title="Automatically document your learnings"
        >
          With one click, summarize your learnings during study sessions and
          aggregate learnings across study sessions.
        </Feature>
        <Feature
          icon={<KeyRound strokeWidth={1.6} className="size-3.75" />}
          title="Your keys, your machine"
        >
          BYOK for Anthropic, OpenAI, xAI, or any OpenAI-compatible API,
          including local Ollama, LM Studio, or llama.cpp.
        </Feature>
      </ul>
    </div>
  );
}

function SigninWelcome() {
  return (
    <div className="relative max-w-md">
      <h2 className="text-3xl font-semibold leading-tight tracking-tight">
        Welcome back!
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
        Pick up where you left off.
      </p>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground/85">
        {icon}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-primary-foreground/65">
          {children}
        </div>
      </div>
    </li>
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

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      className="size-4 transition-transform duration-150 group-hover:scale-105"
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
