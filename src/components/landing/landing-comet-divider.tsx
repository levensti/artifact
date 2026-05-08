"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A hairline rule between sections that draws in (scaleX 0 → 1) when it
 * enters the viewport. Spans both columns of the folio grid.
 */
export function CometDivider({
  topPx,
  bottomPx,
}: {
  topPx: number;
  bottomPx: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -5% 0px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-spread">
      <div
        ref={ref}
        className="landing-comet-rule"
        data-shown={shown ? "true" : "false"}
        style={{ margin: `${topPx}px 0 ${bottomPx}px` }}
      />
    </div>
  );
}
