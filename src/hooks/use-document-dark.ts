"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether the document is in dark mode (the `.dark` class on
 * <html>), updating live via a MutationObserver so theme-dependent
 * renderers (Mermaid) can re-render when the theme flips.
 */
export function useDocumentDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
