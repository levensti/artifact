import { describe, it, expect } from "vitest";
import {
  normalizeSmartQuotes,
  fixBrTags,
  stripLatex,
  stripStyleDirectives,
  stripMarkdownEmphasis,
  quoteUnsafeLabels,
  stripXychartTrailing,
  repairMermaid,
} from "@/lib/diagram/mermaid-repair";

describe("normalizeSmartQuotes", () => {
  it("converts curly double and single quotes", () => {
    expect(normalizeSmartQuotes('A["“attention”"]')).toBe('A[""attention""]');
    expect(normalizeSmartQuotes("B[‘x’]")).toBe("B['x']");
    expect(normalizeSmartQuotes("C[„y“]")).toBe('C["y"]');
  });

  it("leaves straight quotes alone", () => {
    expect(normalizeSmartQuotes('A["plain"]')).toBe('A["plain"]');
  });
});

describe("fixBrTags", () => {
  it("normalizes every <br> variant", () => {
    expect(fixBrTags('A["line<br>two"]')).toBe('A["line<br/>two"]');
    expect(fixBrTags('A["line<BR>two"]')).toBe('A["line<br/>two"]');
    expect(fixBrTags('A["line<br >two"]')).toBe('A["line<br/>two"]');
  });

  it("leaves correct tags untouched", () => {
    expect(fixBrTags('A["line<br/>two"]')).toBe('A["line<br/>two"]');
  });
});

describe("stripLatex", () => {
  it("drops $...$ delimiters keeping the inner text", () => {
    expect(stripLatex("A[$O(n^2)$ cost]")).toBe("A[O(n^2) cost]");
  });

  it("drops \\(...\\) delimiters", () => {
    expect(stripLatex("A[\\(x+y\\)]")).toBe("A[x+y]");
  });

  it("unwraps \\text{} and friends", () => {
    expect(stripLatex("A[\\text{softmax}]")).toBe("A[softmax]");
    expect(stripLatex("B[\\mathbf{W} weights]")).toBe("B[W weights]");
  });

  it("drops backslashes from leftover macros", () => {
    expect(stripLatex("A[\\alpha decay]")).toBe("A[alpha decay]");
  });

  it("ignores a lone dollar sign", () => {
    expect(stripLatex("A[costs $5]")).toBe("A[costs $5]");
  });
});

describe("stripStyleDirectives", () => {
  it("removes style/classDef/linkStyle/class/click lines and init directives", () => {
    const src = [
      "flowchart TD",
      '  A["x"] --> B',
      "  style A fill:#f9f",
      "  classDef hot fill:red",
      "  linkStyle 0 stroke:red",
      "  class A hot",
      '  click A href "https://x.test"',
      '%%{init: {"theme":"forest"}}%%',
      "  B --> C",
    ].join("\n");
    expect(stripStyleDirectives(src)).toBe(
      ['flowchart TD', '  A["x"] --> B', "  B --> C"].join("\n"),
    );
  });

  it("preserves node lines byte-for-byte", () => {
    const src = 'flowchart LR\n  A["style guide"] --> B["classy"]';
    expect(stripStyleDirectives(src)).toBe(src);
  });
});

describe("stripMarkdownEmphasis", () => {
  it("unwraps bold markers", () => {
    expect(stripMarkdownEmphasis('A["**Encoder**"]')).toBe('A["Encoder"]');
    expect(stripMarkdownEmphasis("B[__under__]")).toBe("B[under]");
  });
});

describe("quoteUnsafeLabels", () => {
  it("quotes labels with parens", () => {
    expect(quoteUnsafeLabels("A[Encoder (repeated)] --> B")).toBe(
      'A["Encoder (repeated)"] --> B',
    );
  });

  it("quotes compound shapes", () => {
    expect(quoteUnsafeLabels("B{{f(x)}}")).toBe('B{{"f(x)"}}');
    expect(quoteUnsafeLabels("C([a/b])")).toBe('C(["a/b"])');
    expect(quoteUnsafeLabels("D((x: y))")).toBe('D(("x: y"))');
  });

  it("leaves already-quoted labels alone", () => {
    expect(quoteUnsafeLabels('A["f(x)"] --> B')).toBe('A["f(x)"] --> B');
  });

  it("leaves safe labels alone", () => {
    expect(quoteUnsafeLabels("A[Encoder] --> B[Decoder]")).toBe(
      "A[Encoder] --> B[Decoder]",
    );
  });
});

describe("stripXychartTrailing", () => {
  it("strips a stray trailing label on a single-series chart", () => {
    const src = "xychart-beta\n  x-axis [1, 2]\n  bar [10, 20] Model A";
    expect(stripXychartTrailing(src)).toBe(
      "xychart-beta\n  x-axis [1, 2]\n  bar [10, 20]",
    );
  });

  it("leaves multi-series charts untouched", () => {
    const src = "xychart-beta\n  bar [1, 2] A\n  bar [3, 4] B";
    expect(stripXychartTrailing(src)).toBe(src);
  });

  it("ignores non-xychart sources", () => {
    const src = "flowchart TD\n  bar [x] --> B";
    expect(stripXychartTrailing(src)).toBe(src);
  });
});

describe("repairMermaid (composed)", () => {
  it("fixes a kitchen-sink broken flowchart", () => {
    const src = [
      "flowchart TD",
      "  A[**Input** $x_t$] --> B[Attention (multi-head)]",
      '  B --> C["score<br>“softmax”"]',
      "  style A fill:#f9f",
    ].join("\n");
    expect(repairMermaid(src)).toBe(
      [
        "flowchart TD",
        "  A[Input x_t] --> B[\"Attention (multi-head)\"]",
        '  B --> C["score<br/>"softmax""]',
      ].join("\n"),
    );
  });

  it("returns a fully valid flowchart unchanged", () => {
    const src = [
      "flowchart LR",
      '  A["Input"] --> B{"Converged?"}',
      "  B -->|no| A",
      '  B -->|yes| C["Output"]',
    ].join("\n");
    expect(repairMermaid(src)).toBe(src);
  });

  it("is idempotent", () => {
    const src = "flowchart TD\n  A[f(x): score] --> B[**B**<br>next]";
    const once = repairMermaid(src);
    expect(repairMermaid(once)).toBe(once);
  });
});
