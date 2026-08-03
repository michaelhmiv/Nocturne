import { AiProviderError, type AiProviderErrorCode } from "@nocturne/ai-gm";

export type ApiErrorClass =
  | "provider_configuration_error"
  | "provider_timeout"
  | "provider_rejected"
  | "provider_failure"
  | "schema_validation_error"
  | "persistence_failure"
  | "internal_error";

export interface ApiErrorClassification {
  statusCode: number;
  errorClass: ApiErrorClass;
  sourceCode?: string;
  message?: string;
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function classifyProviderError(code: AiProviderErrorCode): ApiErrorClassification {
  switch (code) {
    case "configuration":
      return {
        statusCode: 503,
        errorClass: "provider_configuration_error",
        sourceCode: code,
        message: "AI provider is not configured.",
      };
    case "timeout":
    case "aborted":
      return {
        statusCode: 504,
        errorClass: "provider_timeout",
        sourceCode: code,
        message: "AI provider request timed out.",
      };
    case "provider_rejected":
      return {
        statusCode: 502,
        errorClass: "provider_rejected",
        sourceCode: code,
        message: "AI provider rejected the request.",
      };
    case "validation":
    case "malformed_response":
      return {
        statusCode: 502,
        errorClass: "schema_validation_error",
        sourceCode: code,
        message: "AI provider returned an invalid response.",
      };
    case "rate_limited":
    case "provider_failure":
      return {
        statusCode: 502,
        errorClass: "provider_failure",
        sourceCode: code,
        message: "AI provider request failed.",
      };
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

export function classifyUnhandledApiError(error: unknown): ApiErrorClassification {
  if (error instanceof AiProviderError) return classifyProviderError(error.code);

  const sourceCode = errorCode(error);
  if (sourceCode && SQLSTATE_PATTERN.test(sourceCode)) {
    return {
      statusCode: 500,
      errorClass: "persistence_failure",
      sourceCode,
      message: "The request could not be persisted.",
    };
  }

  return {
    statusCode: 500,
    errorClass: "internal_error",
    sourceCode,
  };
}
