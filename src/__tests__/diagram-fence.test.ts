import { describe, it, expect } from "vitest";
import {
  isChartClass,
  isDiagramClass,
  isLegacyMermaidClass,
  retireLegacyVisualFences,
} from "@/lib/diagram/fence";

describe("fence routing", () => {
  it("matches the diagram fence language", () => {
    expect(isDiagramClass("language-diagram")).toBe(true);
    expect(isDiagramClass("language-html")).toBe(false);
    expect(isDiagramClass(undefined)).toBe(false);
  });

  it("matches the chart fence language", () => {
    expect(isChartClass("language-chart")).toBe(true);
    expect(isChartClass("language-json")).toBe(false);
  });

  it("routes legacy mermaid fences (incl. type-named) to the fallback", () => {
    expect(isLegacyMermaidClass("language-mermaid")).toBe(true);
    expect(isLegacyMermaidClass("language-flowchart")).toBe(true);
    expect(isLegacyMermaidClass("language-xychart-beta")).toBe(true);
    expect(isLegacyMermaidClass("language-diagram")).toBe(false);
    expect(isLegacyMermaidClass("language-python")).toBe(false);
  });
});

describe("retireLegacyVisualFences", () => {
  it("relabels mermaid fences (incl. type-named) as text", () => {
    expect(retireLegacyVisualFences("```mermaid\nflowchart TD\n```")).toBe(
      "```text\nflowchart TD\n```",
    );
    expect(retireLegacyVisualFences("```flowchart\nA --> B\n```")).toBe(
      "```text\nA --> B\n```",
    );
  });

  it("leaves live visual fences and ordinary code fences untouched", () => {
    const src =
      '```diagram\n<div class="dx-node">A</div>\n```\n' +
      '```chart\n{"type": "bar"}\n```\n```python\nx = 1\n```';
    expect(retireLegacyVisualFences(src)).toBe(src);
  });

  it("does not touch fence-like text inside a line or closing fences", () => {
    const src = "uses ```mermaid inline``` style\n```mermaid\nA --> B\n```";
    expect(retireLegacyVisualFences(src)).toBe(
      "uses ```mermaid inline``` style\n```text\nA --> B\n```",
    );
  });
});
