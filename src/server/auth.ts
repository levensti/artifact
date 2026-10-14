import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { sendSlackEvent, SlackEventType } from "./notifications";

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
  // Google verifies its users' addresses, so a Google sign-in whose email
  // matches an email + password account links to it instead of failing with
  // OAuthAccountNotLinked. The signIn callback refuses unverified profiles,
  // and the linkAccount event revokes the unverified password (see below).
  providers: [Google({ allowDangerousEmailAccountLinking: true })],
  session: { strategy: "database" },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider === "google") return profile?.email_verified === true;
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // Auth.js also fires this when linking Google to an existing email +
      // password user; only those rows carry a password at this point.
      if ((user as { password?: string | null }).password) return;
      await sendSlackEvent(SlackEventType.Signup, "signed up", user.id);
    },
    async linkAccount({ user, profile }) {
      if (!user.id) return;
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, password: true, emailVerified: true },
      });
      if (!row || row.emailVerified) return;
      // Only an inbox Google vouches for counts as proof of ownership.
      if (profile.email?.toLowerCase() !== row.email.toLowerCase()) return;
      // Email signup never verifies the address, so whoever set this password
      // may not own the inbox (e.g. someone pre-registered the victim's
      // email). Google has now proven ownership: drop that password and any
      // sessions it opened. Runs before Auth.js creates the Google session.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date(), password: null },
        }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
      ]);
    },
    async signIn({ user, isNewUser }) {
      if (isNewUser || !user.id) return;
      await sendSlackEvent(SlackEventType.Signin, "signed in", user.id);
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
