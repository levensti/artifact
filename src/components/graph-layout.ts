/**
 * Radial layout engine for the knowledge graph.
 *
 * Extracted from related-works-graph.tsx to keep layout math
 * separate from React rendering.
 */

import { useMemo } from "react";
import type { GraphData, GraphNode } from "@/lib/explore";
import { normalizeArxivId } from "@/lib/reviews";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Max chars shown inside a pill node */
export const PILL_CHARS = 26;
export const PILL_CHARS_ANCHOR = 32;

/** Approximate char→px for the node font (9px Geist ~5.2px per char) */
const CHAR_W = 5.2;
const PILL_PAD_X = 14;
export const PILL_H = 24;
export const PILL_H_ANCHOR = 28;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PositionedNode = GraphNode & {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "\u2026";
}

export function pillWidth(label: string): number {
  return label.length * CHAR_W + PILL_PAD_X * 2;
}

/** Max satellites on a circle of radius r without chord length dropping below `need` (px). */
function maxNodesOnRing(r: number, need: number): number {
  if (r < 8 || need <= 0) return 1;
  if (2 * r <= need) return 1;
  let lo = 1;
  let hi = 256;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const chord = 2 * r * Math.sin(Math.PI / mid);
    if (chord >= need) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(1, lo);
}

export function paperMatchesQuery(node: GraphNode, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  return (
    node.title.toLowerCase().includes(q) ||
    node.arxivId.toLowerCase().includes(q)
  );
}

/** Push overlapping pill centres apart (circle bounds using max(w,h)). */
function resolveOverlaps(nodes: PositionedNode[], iterations = 140) {
  const pad = 10;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const ra = Math.max(a.w, a.h) / 2 + pad;
        const rb = Math.max(b.w, b.h) / 2 + pad;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = ra + rb;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main layout function                                               */
/* ------------------------------------------------------------------ */

/**
 * Radial layout: anchor at center, satellites on expanding rings. Ring capacity
 * scales with circumference (chord spacing vs pill width) so we never stack
 * too many nodes on one circle.
 */
export function buildRadialLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
): PositionedNode[] {
  const layoutNodes: PositionedNode[] = graph.nodes.map((n) => {
    const isReviewed =
      reviewedArxivIds?.has(normalizeArxivId(n.arxivId)) ?? false;
    const isAnchor = n.isCurrent || isReviewed;
    const maxChars = isAnchor ? PILL_CHARS_ANCHOR : PILL_CHARS;
    const label = truncate(n.title, maxChars);
    const w = pillWidth(label);
    const h = isAnchor ? PILL_H_ANCHOR : PILL_H;
    return { ...n, w, h, label, isCurrent: n.isCurrent || isReviewed, x: 0, y: 0 };
  });

  const cx = width / 2;
  const cy = height / 2;

  if (layoutNodes.length === 0) return [];

  const anchor =
    layoutNodes.find((n) => n.isCurrent) ??
    layoutNodes.find((n) =>
      reviewedArxivIds?.has(normalizeArxivId(n.arxivId)),
    ) ??
    layoutNodes[0];

  const others = layoutNodes.filter((n) => n.id !== anchor.id);

  anchor.x = cx;
  anchor.y = cy;

  if (others.length === 0) {
    return layoutNodes;
  }

  const maxW = Math.max(anchor.w, ...others.map((n) => n.w));
  const gap = 16;
  const need = maxW + gap;

  let idx = 0;
  let r = Math.max(need * 0.55, 88);

  while (idx < others.length) {
    const cap = maxNodesOnRing(r, need);
    const count = Math.min(cap, others.length - idx);
    const slice = others.slice(idx, idx + count);
    slice.forEach((node, j) => {
      const angle = (2 * Math.PI * j) / slice.length - Math.PI / 2;
      node.x = cx + r * Math.cos(angle);
      node.y = cy + r * Math.sin(angle);
    });
    idx += count;
    if (idx >= others.length) break;
    r += Math.max(44, maxW * 0.42 + gap);
  }

  resolveOverlaps(layoutNodes, 160);

  return layoutNodes;
}

/* ------------------------------------------------------------------ */
/*  React hook                                                         */
/* ------------------------------------------------------------------ */

export function useStaticLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
) {
  return useMemo(
    () => buildRadialLayout(graph, width, height, reviewedArxivIds),
    [graph, width, height, reviewedArxivIds],
  );
}
