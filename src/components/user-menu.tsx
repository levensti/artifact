"use client";

import { useSyncExternalStore } from "react";
import { LogOut } from "lucide-react";
import { getCurrentUser, type CurrentUser } from "@/lib/client-data";
import { USER_UPDATED_EVENT } from "@/lib/storage-events";
import { signOutAction } from "@/server/actions";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(USER_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(USER_UPDATED_EVENT, onChange);
}

function snapshot(): CurrentUser | null {
  return getCurrentUser();
}

function initialsFor(user: CurrentUser): string {
  const source = user.name?.trim() || user.email?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function UserMenu() {
  const user = useSyncExternalStore(subscribe, snapshot, () => null);
  if (!user) return null;

  const display = user.name?.trim() || user.email || "Signed in";
  const subline = user.name?.trim() && user.email ? user.email : null;

  return (
    <div className="shrink-0 border-t border-sidebar-border px-2 py-2">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
        <Avatar user={user} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-foreground">
            {display}
          </span>
          {subline ? (
            <span className="truncate text-[11.5px] text-muted-foreground/80">
              {subline}
            </span>
          ) : null}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            title="Sign out"
            aria-label="Sign out"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150",
              "hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60",
            )}
          >
            <LogOut className="size-4" strokeWidth={2} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Avatar({ user }: { user: CurrentUser }) {
  if (user.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        className="size-8 shrink-0 rounded-full bg-sidebar-accent object-cover"
      />
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-foreground/80">
      {initialsFor(user)}
    </span>
  );
}
