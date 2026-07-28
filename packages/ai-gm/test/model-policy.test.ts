import { describe, expect, it } from "vitest";
import { createModelPolicy } from "../src/index.js";

describe("createModelPolicy", () => {
  it("rejects user model selection for authoritative tasks", () => {
    expect(() =>
      createModelPolicy({
        task: "parse_intent",
        authoritativeModel: "openrouter/free",
        requestedModel: "vendor/user-choice",
      }),
    ).toThrow(/authoritative/i);
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
