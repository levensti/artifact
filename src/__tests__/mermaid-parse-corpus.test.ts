// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { repairMermaid } from "@/lib/diagram/mermaid-repair";

/**
 * Runs the real Mermaid parser over a corpus of model-broken sources to
 * assert that (a) they fail as-is and (b) the deterministic repairs make
 * them parse. Guards the repair rules against Mermaid grammar drift.
 */

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

const parses = async (src: string): Promise<boolean> => {
  const result = await mermaid
    .parse(src, { suppressErrors: true })
    .catch(() => false as const);
  return result !== false;
};

const BROKEN_THEN_FIXED: Array<[name: string, src: string]> = [
  [
    "unquoted parens label",
    'flowchart TD\n  A[Encoder (repeated)] --> B["Out"]',
  ],
  [
    "latex and bold in labels",
    "flowchart TD\n  A[**Input** $x_t$] --> B[softmax (scaled)]",
  ],
  [
    "style directives on bad label",
    "flowchart TD\n  A[f(x): score] --> B[ok]\n  style A fill:#f9f,stroke:#333",
  ],
];

const VALID_UNCHANGED: Array<[name: string, src: string]> = [
  [
    "flowchart with subgraphs",
    'flowchart TD\n  subgraph Encoder\n    A["Embed"] --> B["Self-attention"]\n  end\n  B --> C["Decoder"]',
  ],
  [
    "sequence diagram",
    "sequenceDiagram\n  participant U as User\n  U->>Server: request\n  Server-->>U: response",
  ],
  [
    "state diagram",
    "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]",
  ],
];

describe("repairMermaid against the real parser", () => {
  for (const [name, src] of BROKEN_THEN_FIXED) {
    it(`repairs: ${name}`, async () => {
      expect(await parses(src)).toBe(false);
      expect(await parses(repairMermaid(src))).toBe(true);
    });
  }

  // Mermaid happens to tolerate curly quotes in an unquoted label; the
  // normalization pass must not break that.
  it("keeps smart-quoted labels parseable after repair", async () => {
    const src = "flowchart TD\n  A[“attention” scores] --> B[done]";
    expect(await parses(repairMermaid(src))).toBe(true);
  });

  for (const [name, src] of VALID_UNCHANGED) {
    it(`leaves valid source parseable and unchanged: ${name}`, async () => {
      expect(repairMermaid(src)).toBe(src);
      expect(await parses(src)).toBe(true);
    });
  }
});
