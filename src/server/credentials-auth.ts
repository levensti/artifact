"use server";
import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { hashPassword, verifyPassword } from "./passwords";
import { sendSlackEvent, SlackEventType } from "./notifications";

// Match the cookie scope used by NextAuth in src/server/auth.ts so a session
// created here is recognized by the same middleware that handles the Google
// OAuth flow. Database session strategy: the cookie value is the
// `sessionToken` column on the Session row.
const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
const useSecureCookies =
  process.env.NODE_ENV === "production" ||
  !!process.env.AUTH_URL?.startsWith("https://");
const SESSION_COOKIE = `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;
const SESSION_DAYS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CredentialsState {
  error?: string;
  // Echoed so the input keeps its value after a failed submit.
  email?: string;
  name?: string;
}

async function startSession(userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { sessionToken, userId, expires } });
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    domain: COOKIE_DOMAIN,
    expires,
    path: "/",
  });
}

function safeCallback(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  // Only allow relative paths so a poisoned ?callbackUrl can't redirect off-site.
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function signupWithCredentials(
  _prev: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeCallback(formData.get("callbackUrl"));

  if (!EMAIL_RE.test(email)) {
    return { error: "Enter a valid email address.", email, name };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", email, name };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      error: "An account with that email already exists. Try signing in.",
      email,
      name,
    };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      name: name || null,
      password: passwordHash,
    },
  });

  await sendSlackEvent(SlackEventType.Signup, "signed up", user.id);
  await startSession(user.id);
  redirect(callbackUrl);
}

export async function signinWithCredentials(
  _prev: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeCallback(formData.get("callbackUrl"));

  // Generic error for both branches: don't leak whether the email exists.
  const generic = { error: "Incorrect email or password.", email };

  if (!EMAIL_RE.test(email) || !password) return generic;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) return generic;
  const ok = await verifyPassword(password, user.password);
  if (!ok) return generic;

  await sendSlackEvent(SlackEventType.Signin, "signed in", user.id);
  await startSession(user.id);
  redirect(callbackUrl);
}
