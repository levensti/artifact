"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redirect legacy /discovery route to /kb. */
export default function DiscoveryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/kb");
  }, [router]);
  return null;
}
