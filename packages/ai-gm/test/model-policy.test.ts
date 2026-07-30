import { describe, expect, it } from "vitest";
import { DEEPSEEK_FLASH_MODEL, createModelPolicy } from "../src/index.js";

describe("createModelPolicy", () => {
  it("pins authoritative tasks to DeepSeek Flash", () => {
    const policy = createModelPolicy({ task: "parse_intent" });

    expect(policy.model).toBe(DEEPSEEK_FLASH_MODEL);
    expect(policy.authority).toBe("authoritative");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("pins creative tasks to DeepSeek Flash", () => {
    const policy = createModelPolicy({ task: "narrate_event" });

    expect(policy.model).toBe(DEEPSEEK_FLASH_MODEL);
    expect(policy.authority).toBe("creative");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("ignores attempted model overrides", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "not-allowed",
      requestedModel: "not-allowed",
    });

    expect(policy.model).toBe(DEEPSEEK_FLASH_MODEL);
  });
});
