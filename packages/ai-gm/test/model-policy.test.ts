import { describe, expect, it } from "vitest";
import { createModelPolicy } from "../src/index.js";

describe("createModelPolicy", () => {
  it("uses the configured authoritative model", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "deepseek-v4-flash",
    });

    expect(policy.model).toBe("deepseek-v4-flash");
    expect(policy.authority).toBe("authoritative");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("uses the configured creative model", () => {
    const policy = createModelPolicy({
      task: "narrate_event",
      creativeModel: "deepseek-v4-flash",
    });

    expect(policy.model).toBe("deepseek-v4-flash");
    expect(policy.authority).toBe("creative");
  });

  it("allows an internal requested model to override the configured default", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "deepseek-v4-flash",
      requestedModel: "deepseek-v4-pro",
    });

    expect(policy.model).toBe("deepseek-v4-pro");
  });
});
