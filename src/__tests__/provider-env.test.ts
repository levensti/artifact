import { describe, it, expect, afterEach } from "vitest";
import {
  resolveOpenRouterKey,
  platformOpenRouterAvailable,
} from "@/server/provider-env";

function clearEnv() {
  delete process.env.OPENROUTER_API_KEY;
}

afterEach(clearEnv);

describe("resolveOpenRouterKey", () => {
  it("uses the caller's inline key when present (trimmed)", () => {
    process.env.OPENROUTER_API_KEY = "platform-key";
    expect(resolveOpenRouterKey("  user-key  ")).toBe("user-key");
  });

  it("falls back to the platform env key when no inline key", () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-platform  ";
    expect(resolveOpenRouterKey("")).toBe("sk-or-platform");
    expect(resolveOpenRouterKey(undefined)).toBe("sk-or-platform");
    expect(resolveOpenRouterKey("   ")).toBe("sk-or-platform");
  });

  it("returns null when both inline and env are empty", () => {
    clearEnv();
    expect(resolveOpenRouterKey("")).toBeNull();
    expect(resolveOpenRouterKey(undefined)).toBeNull();
  });

  it("treats a whitespace-only env value as unset", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(resolveOpenRouterKey("")).toBeNull();
  });
});

describe("platformOpenRouterAvailable", () => {
  it("is true when the env key is set", () => {
    process.env.OPENROUTER_API_KEY = "super-secret-key";
    expect(platformOpenRouterAvailable()).toBe(true);
  });

  it("is false when no env key is configured", () => {
    clearEnv();
    expect(platformOpenRouterAvailable()).toBe(false);
  });

  it("is false for a whitespace-only env value", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(platformOpenRouterAvailable()).toBe(false);
  });
});
