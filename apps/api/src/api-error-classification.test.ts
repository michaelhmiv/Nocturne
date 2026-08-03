import { AiProviderError } from "@nocturne/ai-gm";
import { describe, expect, it } from "vitest";
import { classifyUnhandledApiError } from "./api-error-classification.js";

describe("classifyUnhandledApiError", () => {
  it("classifies typed provider failures without inspecting arbitrary code properties", () => {
    expect(classifyUnhandledApiError(new AiProviderError("provider_rejected", "rejected"))).toEqual({
      statusCode: 502,
      errorClass: "provider_rejected",
      sourceCode: "provider_rejected",
      message: "AI provider rejected the request.",
    });
  });

  it("classifies PostgreSQL SQLSTATE errors as persistence failures", () => {
    const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });

    expect(classifyUnhandledApiError(error)).toEqual({
      statusCode: 500,
      errorClass: "persistence_failure",
      sourceCode: "23505",
      message: "The request could not be persisted.",
    });
  });

  it("does not treat an untyped timeout code as a provider error", () => {
    const error = Object.assign(new Error("unrelated subsystem timeout"), { code: "timeout" });

    expect(classifyUnhandledApiError(error)).toEqual({
      statusCode: 500,
      errorClass: "internal_error",
      sourceCode: "timeout",
    });
  });
});
