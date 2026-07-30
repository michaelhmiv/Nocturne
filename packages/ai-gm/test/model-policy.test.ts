import { describe, expect, it } from "vitest";
import { createModelPolicy } from "../src/index.js";

describe("createModelPolicy", () => {
  it("always routes authoritative tasks through deepseek v4 flash", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "vendor/configured-model",
      requestedModel: "vendor/user-choice",
    });

    expect(policy.model).toBe("deepseek-v4-flash");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("always routes creative tasks through deepseek v4 flash", () => {
    const policy = createModelPolicy({
      task: "narrate_event",
      creativeModel: "vendor/configured-model",
      requestedModel: "vendor/user-choice",
    });

    expect(policy.model).toBe("deepseek-v4-flash");
    expect(policy.allowUserOverride).toBe(false);
  });
});
