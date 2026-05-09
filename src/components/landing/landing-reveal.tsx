"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /// Delay (ms) after the element enters the viewport before fading in.
  /// Use to stagger sibling reveals (e.g. 0, 80, 160 across a row).
  delayMs?: number;
  /// CSS to forward to the wrapper. Tailwind classes work too.
  className?: string;
  /// When true (default), the element starts hidden until it intersects.
  /// Set false for the hero section, where there's no scroll on first paint
  /// and the element should fade in immediately.
  scrollGate?: boolean;
}

/**
 * Wraps a section in a fade-up reveal triggered by IntersectionObserver.
 * Reveals once and stays visible (no exit animation). The wrapper carries
 * the `landing-reveal` class so the CSS in globals.css can short-circuit
 * the animation entirely under `prefers-reduced-motion: reduce`.
 */
export function Reveal({
  children,
  delayMs = 0,
  className,
  scrollGate = true,
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!scrollGate) {
      // Defer one frame so the initial-hidden state paints first, then the
      // CSS transition runs. Without this the element is already at its
      // final state on first paint and the animation looks like nothing.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }

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
      // Trigger a touch before the element is fully on-screen so the
      // animation has time to play during a normal scroll.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollGate]);

  return (
    <div
      ref={ref}
      className={`landing-reveal ${className ?? ""}`}
      data-shown={shown ? "true" : "false"}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(14px)",
        filter: shown ? "blur(0px)" : "blur(4px)",
        transition: `opacity 750ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms, transform 750ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms, filter 750ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
        willChange: shown ? "auto" : "opacity, transform, filter",
      }}
    >
      {children}
    </div>
  );
}
