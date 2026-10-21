import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  applyArtifactEdits,
  ARTIFACT_SOURCE_OMITTED,
  artifactRefFromOutput,
  artifactUpdateProgress,
  formatArtifactRef,
  stripArtifactSource,
  stripArtifactSourceFromMessages,
} from "@/lib/artifacts";
import { lintArtifactHtml } from "@/server/artifact-lint";
import {
  buildArtifactDocument,
  changedPaths,
  prepareArtifactBody,
} from "@/lib/artifact-frame";
import type { ChatAssistantBlock, ToolCallBlock } from "@/lib/review-types";

const parser = new new JSDOM("").window.DOMParser();

describe("artifact refs", () => {
  it("round-trips through tool output", () => {
    const out = `Updated artifact "X" to v3 ${formatArtifactRef({ id: "3f2a-91", version: 3 })}. Reply…`;
    expect(artifactRefFromOutput(out)).toEqual({ id: "3f2a-91", version: 3 });
  });

  it("is null for errors and legacy output", () => {
    expect(artifactRefFromOutput("Error: not saved.")).toBeNull();
    expect(artifactRefFromOutput('Artifact "X" created.')).toBeNull();
    expect(artifactRefFromOutput(undefined)).toBeNull();
  });
});

describe("applyArtifactEdits", () => {
  const src = "<h2>Method</h2><p>Hard words.</p><p>Results.</p>";

  it("applies edits in order", () => {
    const res = applyArtifactEdits(src, [
      { old_str: "Hard words.", new_str: "Plain words." },
      { old_str: "Plain words.", new_str: "Plain words, with an example." },
    ]);
    expect(res).toEqual({
      ok: true,
      html: "<h2>Method</h2><p>Plain words, with an example.</p><p>Results.</p>",
    });
  });

  it("rejects an edit that's missing or ambiguous, applying none", () => {
    expect(applyArtifactEdits(src, [{ old_str: "nope", new_str: "" }]).ok).toBe(false);
    const twice = applyArtifactEdits(src, [{ old_str: "<p>", new_str: "<p class='x'>" }]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toMatch(/more than once/);
  });

  it("deletes with an empty new_str", () => {
    const res = applyArtifactEdits(src, [{ old_str: "<p>Results.</p>", new_str: "" }]);
    expect(res.ok && res.html).toBe("<h2>Method</h2><p>Hard words.</p>");
  });
});

describe("stripArtifactSource", () => {
  const blocks: ChatAssistantBlock[] = [
    { type: "text_segment", content: "Here it is." },
    {
      type: "tool_call",
      id: "c1",
      name: "create_artifact",
      input: { title: "Overview", summary: "S", html: "<script>evil()</script>" },
      output: `Created artifact "Overview" ${formatArtifactRef({ id: "a1", version: 1 })}.`,
    },
    {
      type: "tool_call",
      id: "c2",
      name: "update_artifact",
      input: { artifact_id: "a1", change: "Simpler", edits: [{ old_str: "a", new_str: "b" }] },
      output: "Updated…",
    },
    {
      type: "tool_call",
      id: "c3",
      name: "read_artifact",
      input: { artifact_id: "a1" },
      output: "<p>source</p>",
    },
    { type: "tool_call", id: "c4", name: "search_paper", input: { query: "q" }, output: "hits" },
  ];

  it("keeps titles, changes, and refs but no page source", () => {
    const out = stripArtifactSource(blocks);
    const json = JSON.stringify(out);
    expect(json).not.toContain("evil()");
    expect(json).not.toContain("<p>source</p>");
    expect(json).toContain("Overview");
    expect(json).toContain("Simpler");
    const created = out[1] as ToolCallBlock;
    expect(artifactRefFromOutput(created.output)).toEqual({ id: "a1", version: 1 });
    expect(created.input.html).toBe(ARTIFACT_SOURCE_OMITTED);
    expect(out[4]).toEqual(blocks[4]);
  });

  it("strips every message's blocks (share import)", () => {
    const messages = stripArtifactSourceFromMessages([
      { id: "m1", content: "hi" },
      { id: "m2", content: "", blocks },
    ]);
    expect(JSON.stringify(messages)).not.toContain("evil()");
    expect(messages[0]).toEqual({ id: "m1", content: "hi" });
  });
});

describe("artifactUpdateProgress", () => {
  it("reports the change line once it's written", () => {
    expect(artifactUpdateProgress('{"artifact_id": "a1", "change": "Simpl')).toEqual({ steps: [] });
    expect(artifactUpdateProgress('{"artifact_id": "a1", "change": "Simpler method", "ed')).toEqual({
      title: "Simpler method",
      steps: [],
    });
  });
});

describe("lintArtifactHtml", () => {
  it("rejects network access, external URLs, forms, navigation, and storage", () => {
    const cases = [
      "<script>fetch('/x')</script>",
      '<img src="https://e.com/a.png">',
      "<style>.a{background:url(https://e.com/x)}</style>",
      "<form><input></form>",
      '<input type="password">',
      "<script>location.href = 'https://e.com'</script>",
      "<script>window.open('x')</script>",
      "<script>localStorage.setItem('a', 1)</script>",
      '<script src="x.js"></script>',
      '<meta http-equiv="refresh" content="0;url=x">',
    ];
    for (const html of cases) {
      expect(lintArtifactHtml(html).errors.length, html).toBeGreaterThan(0);
    }
  });

  it("judges script rules on code only, not prose", () => {
    expect(lintArtifactHtml("<p>We fetch (and rank) passages; location = top.</p>").errors).toEqual([]);
    expect(lintArtifactHtml('<button onclick="fetch(1)">x</button>').errors.length).toBe(1);
  });

  it("accepts ordinary interactive pages", () => {
    const page =
      '<section class="dx-card"><input id="t" type="range"><svg viewBox="0 0 10 10"><rect fill="var(--chart-1)"/></svg></section>' +
      "<script>const t = document.getElementById('t'); t.addEventListener('input', () => artifact.setState({ t: t.value }));</script>";
    const res = lintArtifactHtml(page);
    expect(res.errors).toEqual([]);
    expect(res.html).toBe(page);
    expect(res.styleFixes).toBe(0);
  });

  it("maps raw colors and fonts in markup to theme tokens", () => {
    const res = lintArtifactHtml(
      '<div style="color: #1c1b19; background: rgba(30, 43, 94, 0.5); font-family: Comic Sans">' +
        '<svg><circle fill="#dc2626" stroke="blue"/><rect fill="url(#abc)"/></svg></div>' +
        "<style>#fab { border: 1px solid #e7e5e1 } code { font-family: Menlo }</style>",
    );
    expect(res.errors).toEqual([]);
    expect(res.html).toContain("color: var(--foreground)");
    expect(res.html).toContain("background: color-mix(in srgb, var(--primary) 50%, transparent)");
    expect(res.html).toContain("font-family: var(--font-sans)");
    expect(res.html).toContain('fill="var(--destructive)"');
    expect(res.html).toContain('stroke="var(--chart-3)"');
    expect(res.html).toContain('fill="url(#abc)"');
    // Selectors that look like hex colors are left alone.
    expect(res.html).toContain("#fab { border: 1px solid var(--border) }");
    expect(res.html).toContain("font-family: var(--font-mono)");
  });

  it("never rewrites script bodies", () => {
    const script = "<script>ctx.fillStyle = '#ff0000'; el.style.color = 'red';</script>";
    expect(lintArtifactHtml(script).html).toBe(script);
  });
});

describe("prepareArtifactBody", () => {
  it("turns paper references into chips and leaves scripts alone", () => {
    const out = prepareArtifactBody(
      "<p>See §3.2 and Fig. 4.</p><script>const s = '§1';</script>",
      parser,
    );
    expect(out).toContain(
      '<button type="button" class="citation-chip" data-cite-kind="section" data-cite-value="3.2">§3.2</button>',
    );
    expect(out).toContain('data-cite-kind="figure" data-cite-value="4"');
    expect(out).toContain("<script>const s = '§1';</script>");
  });

  it("renders $…$ math as MathML but not prices", () => {
    const out = prepareArtifactBody("<p>Loss $L_{CE}$ costs $5 and $10.</p>", parser);
    expect(out).toContain("<math");
    expect(out).toContain("costs $5 and $10.");
  });
});

describe("changedPaths", () => {
  it("descends to the one element that changed", () => {
    const prev = "<p>Intro</p><section><h3>Method</h3><p>Hard.</p></section><p>End</p>";
    const next = "<p>Intro</p><section><h3>Method</h3><p>Easy.</p></section><p>End</p>";
    expect(changedPaths(prev, next, parser)).toEqual([[1, 1]]);
  });

  it("lists every new or changed top-level element", () => {
    const prev = "<p>A</p><p>B</p>";
    const next = "<p>A</p><p>B2</p><div>C</div>";
    expect(changedPaths(prev, next, parser)).toEqual([[1], [2]]);
  });

  it("ignores script and style changes", () => {
    expect(changedPaths("<p>A</p><script>1</script>", "<p>A</p><script>2</script>", parser)).toEqual(
      [],
    );
  });
});

describe("buildArtifactDocument", () => {
  it("locks the page down and can't be broken out of by state", () => {
    const doc = buildArtifactDocument({
      body: "<p>hi</p>",
      themeCss: ":root{}",
      state: { note: "</script><script>alert(1)</script>" },
      fontOrigin: "https://app.test",
    });
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("font-src data: https://app.test");
    expect(doc).not.toContain("</script><script>alert(1)");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<script"));
  });
});
