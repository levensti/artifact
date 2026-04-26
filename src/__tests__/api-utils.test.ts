import { describe, it, expect } from "vitest";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";

describe("jsonError", () => {
  it("returns a Response with correct status", async () => {
    const res = jsonError("Not found", 404);
    expect(res.status).toBe(404);
  });

  it("returns JSON body with error field", async () => {
    const res = jsonError("Bad request", 400);
    const body = await res.json();
    expect(body).toEqual({ error: "Bad request" });
  });

  it("sets Content-Type header", () => {
    const res = jsonError("err", 500);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("parseApiErrorMessage", () => {
  it("extracts nested error.message from JSON", () => {
    const json = JSON.stringify({ error: { message: "Rate limited" } });
    expect(parseApiErrorMessage(json, "fallback")).toBe("Rate limited");
  });

  it("extracts string error field (Ollama-style)", () => {
    const json = JSON.stringify({ error: "model not found" });
    expect(parseApiErrorMessage(json, "fallback")).toBe("model not found");
  });

  it("extracts top-level message field", () => {
    const json = JSON.stringify({ message: "upstream offline" });
    expect(parseApiErrorMessage(json, "fallback")).toBe("upstream offline");
  });

  it("appends snippet for plain-text bodies", () => {
    expect(parseApiErrorMessage("Forbidden", "Upstream error")).toBe(
      "Upstream error: Forbidden",
    );
  });

  it("appends snippet for JSON without recognized error fields", () => {
    const json = JSON.stringify({ status: "error" });
    expect(parseApiErrorMessage(json, "fallback")).toBe(
      `fallback: ${json}`,
    );
  });

  it("returns fallback for HTML error pages", () => {
    const html = "<!doctype html><html><body>502</body></html>";
    expect(parseApiErrorMessage(html, "fallback")).toBe("fallback");
  });

  it("returns fallback for empty string", () => {
    expect(parseApiErrorMessage("", "fallback")).toBe("fallback");
  });

  it("truncates very long bodies", () => {
    const long = "x".repeat(500);
    const out = parseApiErrorMessage(long, "fallback");
    expect(out.startsWith("fallback: ")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(250);
  });
});
