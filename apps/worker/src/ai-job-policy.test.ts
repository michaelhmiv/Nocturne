import { describe, expect, it } from "vitest";
import { aiJobErrorCode, aiJobIsRetryable, aiJobRetryDelaySeconds } from "./ai-job-policy.js";

describe("AI job failure policy", () => {
  it("does not retry authoritative quantity validation failures", () => {
    const error = new Error(
      "AI job API failed: Consumable analysis exceeds the available source quantity.",
    );
    expect(aiJobIsRetryable(error)).toBe(false);
  });

  it("honors structured API retry policy and stable error codes", () => {
    const error = Object.assign(new Error("AI job API failed: structured output remained invalid"), {
      code: "ai_validation_failed",
      retryable: false,
    });
    expect(aiJobIsRetryable(error)).toBe(false);
    expect(aiJobErrorCode(error)).toBe("ai_validation_failed");
  });

  it("still retries transient provider and network failures", () => {
    expect(aiJobIsRetryable(new Error("fetch failed: ECONNREFUSED"))).toBe(true);
    expect(aiJobIsRetryable(new Error("AI job API failed: provider timeout"))).toBe(true);
    expect(
      aiJobIsRetryable(
        Object.assign(new Error("AI job API failed: provider timeout"), {
          code: "provider_timeout",
          retryable: true,
        }),
      ),
    ).toBe(true);
  });

  it("keeps bounded exponential retry delays and stable error codes", () => {
    expect(aiJobRetryDelaySeconds(1)).toBe(5);
    expect(aiJobRetryDelaySeconds(3)).toBe(20);
    expect(aiJobErrorCode(new Error("fetch failed: ECONNREFUSED"))).toBe(
      "worker_api_unreachable",
    );
  });
});
