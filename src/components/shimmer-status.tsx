"use client";

/**
 * The assistant's single in-progress indicator: a short label that shimmers
 * while work is happening. One component for every transient status —
 * "Thinking", "Drawing the flowchart", etc. — so they look and feel identical
 * and only the copy changes.
 */
export default function ShimmerStatus({ label }: { label: string }) {
  return (
    <div className="py-0.5" role="status" aria-label={label}>
      <span
        className="thinking-shimmer text-[15px]"
        style={{ fontFamily: "var(--font-reading)", fontWeight: 500 }}
      >
        {label}…
      </span>
    </div>
  );
}
