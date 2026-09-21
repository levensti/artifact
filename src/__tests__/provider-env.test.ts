import { describe, it, expect, afterEach } from "vitest";
import {
  resolveFireworksKey,
  platformFireworksAvailable,
  platformOpenRouterKey,
  platformOpenRouterAvailable,
} from "@/server/provider-env";

function clearEnv() {
  delete process.env.FIREWORKS_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
}

afterEach(clearEnv);

describe("resolveFireworksKey", () => {
  it("uses the caller's inline key when present (trimmed)", () => {
    process.env.FIREWORKS_API_KEY = "platform-key";
    expect(resolveFireworksKey("  user-key  ")).toBe("user-key");
  });

  it("falls back to the platform env key when no inline key", () => {
    process.env.FIREWORKS_API_KEY = "  fw-platform  ";
    expect(resolveFireworksKey("")).toBe("fw-platform");
    expect(resolveFireworksKey(undefined)).toBe("fw-platform");
    expect(resolveFireworksKey("   ")).toBe("fw-platform");
  });

  it("returns null when both inline and env are empty", () => {
    clearEnv();
    expect(resolveFireworksKey("")).toBeNull();
    expect(resolveFireworksKey(undefined)).toBeNull();
  });

  it("treats a whitespace-only env value as unset", () => {
    process.env.FIREWORKS_API_KEY = "   ";
    expect(resolveFireworksKey("")).toBeNull();
  });

  it("never falls back to the OpenRouter (TTS) key", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-tts";
    expect(resolveFireworksKey("")).toBeNull();
  });
});

describe("platformFireworksAvailable", () => {
  it("is true when the env key is set", () => {
    process.env.FIREWORKS_API_KEY = "super-secret-key";
    expect(platformFireworksAvailable()).toBe(true);
  });

  it("is false when no env key is configured", () => {
    clearEnv();
    expect(platformFireworksAvailable()).toBe(false);
  });

  it("is false for a whitespace-only env value", () => {
    process.env.FIREWORKS_API_KEY = "   ";
    expect(platformFireworksAvailable()).toBe(false);
  });
});

describe("platformOpenRouterKey", () => {
  it("returns the trimmed env key when set", () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-platform  ";
    expect(platformOpenRouterKey()).toBe("sk-or-platform");
    expect(platformOpenRouterAvailable()).toBe(true);
  });

  it("is null/false when unset or whitespace-only", () => {
    clearEnv();
    expect(platformOpenRouterKey()).toBeNull();
    process.env.OPENROUTER_API_KEY = "   ";
    expect(platformOpenRouterKey()).toBeNull();
    expect(platformOpenRouterAvailable()).toBe(false);
  });

  it("never reads the Fireworks (chat) key", () => {
    process.env.FIREWORKS_API_KEY = "fw-chat";
    expect(platformOpenRouterKey()).toBeNull();
  });
});
