"use client";

import { useEffect } from "react";
import { hydrateClientStore } from "@/lib/client-data";

/** Loads SQLite-backed app state into the client cache once per session. */
export default function DataHydration() {
  useEffect(() => {
    void hydrateClientStore();
  }, []);
  return null;
}
