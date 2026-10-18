import { describe, expect, it } from "vitest";
import { citePicks } from "@/components/brief-parts";
import type { Recommendation } from "@/lib/discover-types";

const rec = (id: string, rank: number, title: string) =>
  ({ id, rank, title }) as unknown as Recommendation;

describe("citePicks", () => {
  it("cites the first mention of each pick with its rank", () => {
    const out = citePicks(
      "Flow Matching for Generative Modeling sets it up. Later, Flow Matching for Generative Modeling again.",
      [rec("a", 1, "Flow Matching for Generative Modeling")],
    );
    expect(out).toBe(
      "Flow Matching for Generative Modeling[1](#pick-a) sets it up. Later, Flow Matching for Generative Modeling again.",
    );
  });

  it("falls back to the title before a colon, case-insensitively", () => {
    const out = citePicks("The rectified flow paper, flow straight and fast, shows it.", [
      rec("b", 2, "Flow Straight and Fast: Learning to Generate and Transfer Data"),
    ]);
    expect(out).toContain("flow straight and fast[2](#pick-b)");
  });

  it("leaves mentions inside markdown links alone", () => {
    const prose = "See [Scaling Rectified Flow Transformers](https://arxiv.org/abs/2403.03206).";
    expect(citePicks(prose, [rec("c", 3, "Scaling Rectified Flow Transformers")])).toBe(prose);
  });

  it("escapes regex characters in titles and skips very short ones", () => {
    const out = citePicks("Results in Diffusion (v2)? were strong. GAN too.", [
      rec("d", 4, "Diffusion (v2)?"),
      rec("e", 5, "GAN"),
    ]);
    expect(out).toBe("Results in Diffusion (v2)?[4](#pick-d) were strong. GAN too.");
  });
});
