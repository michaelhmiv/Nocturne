import { describe, expect, it } from "vitest";
import { aiJobErrorCode, aiJobRetryDelaySeconds } from "../src/ai-job-policy.js";

describe("AI job retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(aiJobRetryDelaySeconds(1)).toBe(5);
    expect(aiJobRetryDelaySeconds(2)).toBe(10);
    expect(aiJobRetryDelaySeconds(3)).toBe(20);
    expect(aiJobRetryDelaySeconds(100)).toBe(300);
  });

  it("normalizes invalid attempts and error codes", () => {
    expect(aiJobRetryDelaySeconds(0)).toBe(5);
    expect(aiJobErrorCode(new TypeError("bad"))).toBe("TypeError");
    expect(aiJobErrorCode("bad")).toBe("ai_job_failed");
  });
});
