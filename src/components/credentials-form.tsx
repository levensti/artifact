"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MonoLabel } from "@/components/folio";
import { cn } from "@/lib/utils";
import {
  signinWithCredentials,
  signupWithCredentials,
  type CredentialsState,
} from "@/server/credentials-auth";

interface Props {
  mode: "signin" | "signup";
  callbackUrl: string;
}

const initialState: CredentialsState = {};

export function CredentialsForm({ mode, callbackUrl }: Props) {
  const isSignup = mode === "signup";
  const [state, formAction, pending] = useActionState(
    isSignup ? signupWithCredentials : signinWithCredentials,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3.5" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {state.error ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-[13px] leading-snug text-destructive"
        >
          {state.error}
        </div>
      ) : null}

      {isSignup ? (
        <Field label="Full name" htmlFor="name">
          <Input
            // Remount on a new echoed value from the server action so Base UI
            // doesn't warn about `defaultValue` changing post-mount.
            key={`name:${state.name ?? ""}`}
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="What should we call you?"
            defaultValue={state.name ?? ""}
            className="h-10"
          />
        </Field>
      ) : null}

      <Field label="Email" htmlFor="email">
        <Input
          key={`email:${state.email ?? ""}`}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@domain.com"
          defaultValue={state.email ?? ""}
          className="h-10"
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={isSignup ? "At least 8 characters." : undefined}
      >
        <PasswordInput isSignup={isSignup} />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "group relative flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground",
          "shadow-(--shadow-primary) transition-all duration-150",
          "hover:-translate-y-px hover:brightness-[1.07]",
          "active:translate-y-0 active:brightness-100",
          "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:brightness-100",
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
        ) : null}
        <span>
          {pending
            ? isSignup
              ? "Creating account"
              : "Signing in"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </span>
      </button>
    </form>
  );
}

function PasswordInput({ isSignup }: { isSignup: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete={isSignup ? "new-password" : "current-password"}
        required
        minLength={isSignup ? 8 : undefined}
        placeholder={isSignup ? "Pick a strong password" : "Your password"}
        className="h-10 pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="size-4" strokeWidth={1.75} />
        ) : (
          <Eye className="size-4" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  optional?: boolean;
}

function Field({ label, htmlFor, children, hint, optional }: FieldProps) {
  const hintId = useId();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-baseline justify-between gap-2"
      >
        <MonoLabel>{label}</MonoLabel>
        {optional ? (
          <span className="text-[10.5px] font-medium tracking-[0.05em] text-muted-foreground/60">
            optional
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p
          id={hintId}
          className="pt-0.5 text-[11.5px] leading-snug text-muted-foreground/75"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
