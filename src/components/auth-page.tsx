import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth";
import {
  BrandGlyph,
  BrandPanel,
  SigninWelcome,
  SignupPitch,
} from "@/components/brand-panel";
import { MonoLabel } from "@/components/folio";
import { CredentialsForm } from "@/components/credentials-form";

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
      <BrandPanel>{isSignup ? <SignupPitch /> : <SigninWelcome />}</BrandPanel>
      <section className="relative flex items-center justify-center overflow-hidden px-6 py-12 text-left sm:px-10">
        {/* Soft primary-tinted radial, keeps the surface from feeling flat */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,color-mix(in_srgb,var(--primary)_7%,transparent),transparent_55%),radial-gradient(circle_at_15%_95%,color-mix(in_srgb,var(--primary)_4%,transparent),transparent_55%)]"
        />

        <div className="relative mx-auto w-full max-w-sm text-left animate-in fade-in slide-in-from-bottom-2 duration-500">
          {/* Inline brand mark, only when the side panel is hidden */}
          <div className="mb-10 flex items-center gap-2 md:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandGlyph className="size-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">
              Artifact
            </span>
          </div>

          <header className="mb-7">
            <MonoLabel>
              {isSignup ? "Create your account" : "Sign in"}
            </MonoLabel>
            <h1 className="mt-3.5 text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
              {isSignup
                ? "Set up your reading workspace."
                : "Welcome back."}
            </h1>
            <p
              className="mt-3 text-[14.5px] leading-[1.6]"
              style={{
                fontFamily: "var(--font-reading)",
                color: "color-mix(in srgb, var(--foreground) 72%, transparent)",
              }}
            >
              {isSignup
                ? "Use your email, or continue with Google. Bring your own API keys later if you want."
                : "Sign in to pick up where you left off."}
            </p>
          </header>

          <CredentialsForm mode={mode} callbackUrl={target} />

          {/* Hairline divider */}
          <div className="mt-7 flex items-center gap-3 text-muted-foreground/60">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium tracking-[0.18em] uppercase">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            className="mt-6"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: target });
            }}
          >
            <button
              type="submit"
              className="group flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-[14px] font-medium text-foreground/90 shadow-(--shadow-sm) transition-all duration-150 hover:border-primary/35 hover:shadow-(--shadow-primary) hover:-translate-y-px active:translate-y-0"
            >
              <GoogleMark />
              <span>
                {isSignup ? "Sign up with Google" : "Continue with Google"}
              </span>
            </button>
          </form>

          <p className="mt-7 text-[14px] text-muted-foreground">
            {isSignup ? "Already have an account?" : "New to Artifact?"}{" "}
            <Link
              href={`${isSignup ? "/signin" : "/signup"}${cb}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </section>
    </main>
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
