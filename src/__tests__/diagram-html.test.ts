import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import type { WindowLike } from "dompurify";
import { sanitizeDiagramHtml } from "@/lib/diagram/diagram-html";

// The sanitizer is the security and theme boundary for LLM-generated markup,
// so it is exercised against real DOM parsing (jsdom), not string assertions
// alone. Policy: unbounded structure, bounded palette.
const win = new JSDOM("").window as unknown as WindowLike;
const sanitize = (src: string) => sanitizeDiagramHtml(src, win);

describe("sanitizeDiagramHtml — structure", () => {
  it("keeps dx building-block markup intact", () => {
    const src =
      '<div class="dx-title">Pipeline</div>' +
      '<div class="dx-stack">' +
      '<div class="dx-node dx-accent">Encoder <span class="dx-sub">frozen</span></div>' +
      '<div class="dx-arrow">tokens</div>' +
      '<div class="dx-node">Decoder</div>' +
      "</div>";
    const out = sanitize(src);
    expect(out.empty).toBe(false);
    expect(out.html).toBe(src);
  });

  it("keeps tables for matrix layouts", () => {
    const src =
      "<table><thead><tr><th>q</th><th>k</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>0</td></tr></tbody></table>";
    expect(sanitize(src).html).toBe(src);
  });

  it("keeps inline SVG drawing with geometry and theme paint", () => {
    const src =
      '<svg viewBox="0 0 100 60">' +
      '<circle cx="20" cy="30" r="4" fill="var(--chart-1)"></circle>' +
      '<polyline points="10,50 50,20 90,35" stroke="var(--chart-2)" fill="none"></polyline>' +
      '<text x="50" y="55" text-anchor="middle" font-size="8">x</text>' +
      "</svg>";
    const out = sanitize(src);
    expect(out.empty).toBe(false);
    expect(out.html).toContain('viewBox="0 0 100 60"');
    expect(out.html).toContain('fill="var(--chart-1)"');
    expect(out.html).toContain("polyline");
  });

  it("treats a text-free SVG as a real diagram, not empty", () => {
    const out = sanitize('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="var(--muted)"></rect></svg>');
    expect(out.empty).toBe(false);
  });

  it("extracts the first dx-title as the title, null when absent", () => {
    expect(
      sanitize('<div class="dx-title">FTAR</div><div class="dx-node">A</div>')
        .title,
    ).toBe("FTAR");
    expect(sanitize('<div class="dx-node">A</div>').title).toBeNull();
  });

  it("flags markup with no text and no svg as empty", () => {
    expect(sanitize("").empty).toBe(true);
    expect(sanitize('<div class="dx-stack"><br></div>').empty).toBe(true);
    expect(sanitize("<script>alert(1)</script>").empty).toBe(true);
  });
});

describe("sanitizeDiagramHtml — script/URL stripping", () => {
  it("strips script tags entirely, including their content", () => {
    const out = sanitize('<div class="dx-node">ok</div><script>alert(1)</script>');
    expect(out.html).not.toContain("script");
    expect(out.html).not.toContain("alert");
    expect(out.html).toContain("ok");
  });

  it("strips event handler attributes", () => {
    expect(sanitize('<div class="dx-node" onclick="alert(1)">A</div>').html).toBe(
      '<div class="dx-node">A</div>',
    );
  });

  it("strips links and images but keeps link text", () => {
    const out = sanitize(
      '<div class="dx-node"><a href="javascript:alert(1)">label</a></div>' +
        '<img src="x" onerror="alert(1)"><iframe src="https://evil.test"></iframe>',
    );
    expect(out.html).toBe('<div class="dx-node">label</div>');
  });

  it("strips foreignObject and use from SVG", () => {
    const out = sanitize(
      '<svg viewBox="0 0 10 10"><foreignObject><div>x</div></foreignObject>' +
        '<use href="#evil"></use><rect width="5" height="5"></rect></svg>',
    );
    expect(out.html).not.toContain("foreignObject");
    expect(out.html).not.toContain("use");
    expect(out.html).toContain("rect");
  });
});

describe("sanitizeDiagramHtml — class namespace", () => {
  it("keeps dx-* tokens and drops app/tailwind classes", () => {
    expect(
      sanitize('<div class="dx-node diagram-expand-btn fixed inset-0 z-50">A</div>')
        .html,
    ).toBe('<div class="dx-node">A</div>');
  });

  it("removes the class attribute when no token survives", () => {
    expect(sanitize('<div class="absolute z-50">A</div>').html).toBe(
      "<div>A</div>",
    );
  });
});

describe("sanitizeDiagramHtml — style policy", () => {
  it("keeps layout and sizing declarations", () => {
    const out = sanitize(
      '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; width: 80%">A</div>',
    );
    expect(out.html).toContain("display: grid");
    expect(out.html).toContain("grid-template-columns: repeat(3, 1fr)");
    expect(out.html).toContain("width: 80%");
  });

  it("keeps theme-variable colors and color-mix tints", () => {
    const out = sanitize(
      '<div style="background: color-mix(in srgb, var(--chart-1) 25%, transparent); border-color: var(--border)">A</div>',
    );
    expect(out.html).toContain("color-mix(in srgb, var(--chart-1) 25%, transparent)");
    expect(out.html).toContain("border-color: var(--border)");
  });

  it("drops raw colors (hex, rgb, hsl) — palette is theme-bound", () => {
    const out = sanitize(
      '<div style="color: #ff0000; background: rgb(0,0,0); border-color: hsl(0, 50%, 50%); width: 50%">A</div>',
    );
    expect(out.html).not.toContain("#ff0000");
    expect(out.html).not.toContain("rgb");
    expect(out.html).not.toContain("hsl");
    expect(out.html).toContain("width: 50%");
  });

  it("drops disallowed properties (position, z-index, font-family, content)", () => {
    const out = sanitize(
      '<div style="position: fixed; z-index: 9999; font-family: serif; width: 10px">A</div>',
    );
    expect(out.html).toBe('<div style="width: 10px">A</div>');
  });

  it("drops url() and removes the attribute when nothing survives", () => {
    expect(
      sanitize("<div style=\"background: url(https://evil.test/x.png)\">A</div>")
        .html,
    ).toBe("<div>A</div>");
  });

  it("strips raw-color fill/stroke SVG attributes but keeps var()", () => {
    const out = sanitize(
      '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#888888" stroke="var(--chart-3)"></rect></svg>',
    );
    expect(out.html).not.toContain("#888888");
    expect(out.html).toContain('stroke="var(--chart-3)"');
  });
});
