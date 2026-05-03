import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
const useSecureCookies =
  process.env.NODE_ENV === "production" || !!process.env.AUTH_URL?.startsWith("https://");

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: useSecureCookies,
  domain: COOKIE_DOMAIN,
};
const cookiePrefix = useSecureCookies ? "__Secure-" : "";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
  // Cookie config: when AUTH_COOKIE_DOMAIN is set (prod with apex + subdomain),
  // cookies span the whole zone so a sign-in initiated on apex completes
  // cleanly on the app subdomain. Locally / when unset, Auth.js's host-scoped
  // defaults apply.
  //
  // We override every cookie Auth.js uses during the OAuth dance — sessionToken,
  // callbackUrl, csrfToken, pkceCodeVerifier, state, nonce — because all of
  // them must share scope or the flow breaks halfway through.
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}authjs.session-token`,
      options: cookieOptions,
    },
    callbackUrl: {
      name: `${cookiePrefix}authjs.callback-url`,
      options: cookieOptions,
    },
    csrfToken: {
      // __Host- forbids the domain attribute; if we need cross-subdomain we
      // must use __Secure- instead.
      name: `${cookiePrefix}authjs.csrf-token`,
      options: cookieOptions,
    },
    pkceCodeVerifier: {
      name: `${cookiePrefix}authjs.pkce.code-verifier`,
      options: { ...cookieOptions, maxAge: 900 },
    },
    state: {
      name: `${cookiePrefix}authjs.state`,
      options: { ...cookieOptions, maxAge: 900 },
    },
    nonce: {
      name: `${cookiePrefix}authjs.nonce`,
      options: cookieOptions,
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
