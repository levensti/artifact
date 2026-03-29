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

  it("returns fallback for non-JSON input", () => {
    expect(parseApiErrorMessage("plain text error", "fallback")).toBe("fallback");
  });

  it("returns fallback when error.message is missing", () => {
    const json = JSON.stringify({ status: "error" });
    expect(parseApiErrorMessage(json, "fallback")).toBe("fallback");
  });

  it("returns fallback for empty string", () => {
    expect(parseApiErrorMessage("", "fallback")).toBe("fallback");
  });
});
