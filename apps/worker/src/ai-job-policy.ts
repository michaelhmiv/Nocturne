export function aiJobRetryDelaySeconds(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(300, 5 * 2 ** (normalizedAttempt - 1));
}

function normalizeErrorCode(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 128);
}

export function aiJobIsRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return ![
    "outside the authoritative context",
    "exceeds the available source quantity",
    "exceeds the ambient resource allowance",
    "selected a depleted authoritative source",
    "selected item does not have enough remaining quantity",
    "ambient resource has been depleted",
    "consumption source is missing",
    "character is not controlled by this account",
    "idempotency key was already used for a different ai job",
  ].some((phrase) => message.includes(phrase));
}

export function aiJobErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "ai_job_failed";

  const message = error.message.toLowerCase();
  if (message.includes("forbidden") || message.includes("403")) return "worker_secret_rejected";
  if (message.includes("configuration is missing")) return "worker_configuration_missing";
  if (message.includes("invalid result")) return "invalid_worker_response";
  if (message.includes("timed out") || error.name === "TimeoutError") return "worker_request_timeout";
  if (message.includes("fetch failed") || message.includes("enotfound") || message.includes("econnrefused")) {
    return "worker_api_unreachable";
  }

  const apiFailure = message.match(/ai job api failed:\s*([^\n]+)/);
  if (apiFailure?.[1]) {
    return normalizeErrorCode(apiFailure[1]) || "worker_api_failure";
  }

  const normalizedName = normalizeErrorCode(error.name);
  return normalizedName && normalizedName !== "error" ? normalizedName : "ai_job_failed";
}
