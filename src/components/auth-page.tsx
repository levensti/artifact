import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth";
import {
  BrandMark,
  BrandPanel,
  SigninWelcome,
  SignupPitch,
} from "@/components/brand-panel";
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
      <section className="flex items-center justify-center px-6 py-12 text-left sm:px-10">
        <div className="mx-auto w-full max-w-sm text-left animate-in fade-in duration-300">
          {/* Inline brand mark, only when the side panel is hidden */}
          <div className="mb-10 md:hidden">
            <BrandMark />
          </div>

          <header className="mb-7">
            <p className="landing-label">
              <b>[■]</b>{" "}
              {isSignup ? "Create your account" : "Sign in"}
            </p>
            <h1 className="landing-h2 mt-4">
              {isSignup ? "Set up your reading workspace." : "Welcome back."}
            </h1>
            <p className="landing-lede mt-3 text-[15px]">
              {isSignup
                ? "Use your email, or continue with Google. Free usage on us every day."
                : "Sign in to continue studying."}
            </p>
          </header>

          <CredentialsForm mode={mode} callbackUrl={target} />

          {/* Hairline divider */}
          <div className="mt-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="landing-label">or</span>
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
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
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
      className="size-4"
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
