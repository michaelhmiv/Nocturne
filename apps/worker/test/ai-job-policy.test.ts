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
    expect(aiJobErrorCode(new TypeError("bad"))).toBe("typeerror");
    expect(aiJobErrorCode("bad")).toBe("ai_job_failed");
  });

  it("reports configuration and connectivity failures clearly", () => {
    expect(aiJobErrorCode(new Error("AI job API failed: forbidden"))).toBe("worker_secret_rejected");
    expect(aiJobErrorCode(new Error("fetch failed: ECONNREFUSED"))).toBe("worker_api_unreachable");
    expect(aiJobErrorCode(new Error("AI job worker configuration is missing")))
      .toBe("worker_configuration_missing");
  });
});
