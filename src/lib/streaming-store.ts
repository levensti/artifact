import { useSyncExternalStore } from "react";
import type { AgentStep } from "@/hooks/use-chat";

// Typewriter-paced streaming buffer. The store holds two layers:
//   - `target`: the steps the server has produced so far.
//   - `displayed`: the steps shown to the UI, lagging behind `target` by a
//     smooth chars-per-frame cadence.
//
// A rAF loop advances `displayed` toward `target`. The reveal rate is sized
// to drain the current lag over ~500ms, so server bursts get smoothed into
// steady typewriter motion. Only text growth is paced; non-text steps
// (tool_call, thinking) appear immediately once the preceding text has been
// fully revealed.

let target: AgentStep[] = [];
let displayed: AgentStep[] = [];
let revealedChars = 0;
let rafId: number | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function totalTextChars(steps: AgentStep[]): number {
  let n = 0;
  for (const step of steps) {
    if (step.kind === "text") n += step.text.length;
  }
  return n;
}

function buildDisplayed(t: AgentStep[], budget: number): AgentStep[] {
  const out: AgentStep[] = [];
  let remaining = budget;
  for (const step of t) {
    if (step.kind === "text") {
      if (step.text.length <= remaining) {
        out.push(step);
        remaining -= step.text.length;
      } else {
        if (remaining > 0) {
          out.push({ kind: "text", text: step.text.slice(0, remaining) });
        }
        return out;
      }
    } else {
      out.push(step);
    }
  }
  return out;
}

function tick() {
  rafId = null;
  const total = totalTextChars(target);
  const lag = total - revealedChars;
  if (lag <= 0) return;

  // Aim to drain the current lag over ~500ms (≈30 frames @ 60fps). Snap the
  // final few chars so the cursor doesn't trickle one char per frame.
  let perFrame = Math.max(1, Math.ceil(lag / 30));
  if (lag <= 6) perFrame = lag;

  revealedChars = Math.min(total, revealedChars + perFrame);
  displayed = buildDisplayed(target, revealedChars);
  emit();

  if (revealedChars < totalTextChars(target)) {
    rafId = requestAnimationFrame(tick);
  }
}

function schedule() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

export const streamingStore = {
  set(next: AgentStep[]) {
    target = next;
    if (next.length === 0) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      displayed = [];
      revealedChars = 0;
      emit();
      return;
    }
    const total = totalTextChars(target);
    if (revealedChars > total) revealedChars = total;
    // Rebuild displayed so non-text changes (e.g., a tool_call appearing
    // within the already-revealed range) are visible immediately. Text
    // growth past the revealed budget will be picked up by the rAF tick.
    displayed = buildDisplayed(target, revealedChars);
    emit();
    if (revealedChars < total) schedule();
  },
  subscribe,
};

export function useStreamingSteps(): AgentStep[] {
  return useSyncExternalStore(subscribe, () => displayed, () => displayed);
}
