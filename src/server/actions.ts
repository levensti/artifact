"use server";

import { signOut as authSignOut } from "@/server/auth";

export async function signOutAction(): Promise<void> {
  await authSignOut({ redirectTo: "/signin" });
}
