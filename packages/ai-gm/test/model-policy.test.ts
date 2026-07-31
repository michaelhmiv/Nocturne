import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AI_MODEL, createModelPolicy } from "../src/index.js";

const originalAiModel = process.env.AI_MODEL;

afterEach(() => {
  if (originalAiModel === undefined) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = originalAiModel;
});

describe("createModelPolicy", () => {
  it("uses the production default for authoritative tasks", () => {
    delete process.env.AI_MODEL;
    const policy = createModelPolicy({ task: "parse_intent" });

    expect(policy.model).toBe(DEFAULT_AI_MODEL);
    expect(policy.authority).toBe("authoritative");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("uses the production default for creative tasks", () => {
    delete process.env.AI_MODEL;
    const policy = createModelPolicy({ task: "narrate_event" });

    expect(policy.model).toBe(DEFAULT_AI_MODEL);
    expect(policy.authority).toBe("creative");
    expect(policy.allowUserOverride).toBe(false);
  });

  it("allows server-controlled authoritative and creative models", () => {
    const authoritative = createModelPolicy({
      task: "plan_persistent_world_action",
      authoritativeModel: "authoritative-model",
    });
    const creative = createModelPolicy({
      task: "narrate_event",
      creativeModel: "creative-model",
    });

    expect(authoritative.model).toBe("authoritative-model");
    expect(creative.model).toBe("creative-model");
  });

  it("allows only internal task callers to request a model override", () => {
    const policy = createModelPolicy({
      task: "parse_intent",
      authoritativeModel: "authoritative-model",
      requestedModel: "internal-experiment-model",
    });

    expect(policy.model).toBe("internal-experiment-model");
    expect(policy.allowUserOverride).toBe(false);
  });
});
