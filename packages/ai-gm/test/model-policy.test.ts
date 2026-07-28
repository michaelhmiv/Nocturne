import { describe, expect, it } from "vitest";
import { createModelPolicy } from "../src/index.js";

describe("createModelPolicy", () => {
  it("rejects user model selection for authoritative tasks", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "openrouter/free",
      requestedModel: "vendor/user-choice",
    });
    expect(policy.model).toBe("openrouter/free");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("allows user model selection for creative tasks", () => {
    const policy = createModelPolicy({
      task: "narrate_event",
      creativeModel: "openrouter/free",
      requestedModel: "vendor/user-choice",
    });
    expect(policy.model).toBe("vendor/user-choice");
  });
});
