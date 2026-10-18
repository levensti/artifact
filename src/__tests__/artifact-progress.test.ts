import { describe, expect, it } from "vitest";
import { artifactProgress } from "@/lib/artifacts";

const args = {
  title: 'Skim: "FT-HSDP"',
  summary: "Overview.",
  html:
    "<p>What it does.</p>" +
    "<details open><summary>The problem: replicas fail</summary><p>(§2)</p></details>" +
    "<details><summary>Results: <em>2.1×</em> faster</summary><p>Table 3</p></details>",
};
const full = JSON.stringify(args);

describe("artifactProgress", () => {
  it("reads title and every finished section from complete arguments", () => {
    expect(artifactProgress(full)).toEqual({
      title: 'Skim: "FT-HSDP"',
      steps: [
        { label: "Opening summary", done: true },
        { label: "The problem: replicas fail", done: true },
        { label: "Results: 2.1× faster", done: true },
      ],
    });
  });

  it("has nothing before the title closes", () => {
    expect(artifactProgress('{"title": "Skim: \\"FT')).toEqual({ steps: [] });
  });

  it("marks the section being written as not done", () => {
    const cut = full.slice(0, full.indexOf("Table 3"));
    expect(artifactProgress(cut).steps).toEqual([
      { label: "Opening summary", done: true },
      { label: "The problem: replicas fail", done: true },
      { label: "Results: 2.1× faster", done: false },
    ]);
  });

  it("waits for a summary line to close before listing it", () => {
    const cut = full.slice(0, full.indexOf("Results") + 4);
    expect(artifactProgress(cut).steps.map((s) => s.label)).toEqual([
      "Opening summary",
      "The problem: replicas fail",
    ]);
  });

  it("survives a chunk that ends mid-escape at every cut point", () => {
    for (let i = 0; i <= full.length; i++) {
      expect(() => artifactProgress(full.slice(0, i))).not.toThrow();
    }
    const intro = artifactProgress(full.slice(0, full.indexOf("<details")));
    expect(intro.steps).toEqual([{ label: "Opening summary", done: false }]);
  });
});
