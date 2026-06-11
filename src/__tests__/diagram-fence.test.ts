import { describe, it, expect } from "vitest";
import {
  CORE_MERMAID_LANGS,
  LEGACY_MERMAID_LANGS,
  isMermaidClass,
  isChartClass,
  mermaidLangFromClass,
  mermaidSource,
  diagramTypeName,
} from "@/lib/diagram/fence";

describe("mermaid fence routing", () => {
  it("routes taught langs to mermaid", () => {
    for (const lang of CORE_MERMAID_LANGS) {
      expect(mermaidLangFromClass(`language-${lang}`)).toBe(lang);
    }
  });

  it("still routes legacy chart langs to mermaid (persisted history)", () => {
    for (const lang of LEGACY_MERMAID_LANGS) {
      expect(mermaidLangFromClass(`language-${lang}`)).toBe(lang);
    }
    expect(isMermaidClass("language-pie")).toBe(true);
    expect(isMermaidClass("language-xychart-beta")).toBe(true);
  });

  it("does not route other languages to mermaid", () => {
    expect(isMermaidClass("language-python")).toBe(false);
    expect(isMermaidClass("language-chart")).toBe(false);
    expect(isMermaidClass(undefined)).toBe(false);
    expect(isMermaidClass("")).toBe(false);
  });

  it("is case-insensitive on the language token", () => {
    expect(mermaidLangFromClass("language-Mermaid")).toBe("mermaid");
  });
});

describe("chart fence routing", () => {
  it("routes only ```chart to the chart renderer", () => {
    expect(isChartClass("language-chart")).toBe(true);
    expect(isChartClass("language-mermaid")).toBe(false);
    expect(isChartClass("language-json")).toBe(false);
    expect(isChartClass(undefined)).toBe(false);
  });
});

describe("mermaidSource", () => {
  it("returns the body unchanged for ```mermaid fences", () => {
    expect(mermaidSource("language-mermaid", "flowchart TD\n  A --> B\n")).toBe(
      "flowchart TD\n  A --> B",
    );
  });

  it("prepends the diagram type when fenced by type", () => {
    expect(mermaidSource("language-flowchart", "  A --> B")).toBe(
      "flowchart\n  A --> B",
    );
  });

  it("does not double-prepend when the body already starts with a keyword", () => {
    expect(mermaidSource("language-flowchart", "flowchart LR\n  A --> B")).toBe(
      "flowchart LR\n  A --> B",
    );
  });
});

describe("diagramTypeName", () => {
  it("names known types", () => {
    expect(diagramTypeName("flowchart TD\n A-->B")).toBe("flowchart");
    expect(diagramTypeName("graph LR\n A-->B")).toBe("flowchart");
    expect(diagramTypeName("sequenceDiagram\n A->>B: hi")).toBe(
      "sequence diagram",
    );
    expect(diagramTypeName("stateDiagram-v2\n [*] --> A")).toBe(
      "state diagram",
    );
    expect(diagramTypeName("xychart-beta\n x-axis [1]")).toBe("chart");
  });

  it("falls back to 'diagram'", () => {
    expect(diagramTypeName("unknownthing\n foo")).toBe("diagram");
    expect(diagramTypeName("")).toBe("diagram");
  });
});
