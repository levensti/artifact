"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const OPEN_SETTINGS_FLAG = "artifact-open-settings";

/**
 * Legacy /settings URL: hand off to home and open Settings.
 */
export default function SettingsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_SETTINGS_FLAG, "1");
    } catch {
      /* private mode */
    }
    router.replace("/");
  }, [router]);

  return (
    <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground text-sm">
      Opening Settings...
    </div>
  );
}
