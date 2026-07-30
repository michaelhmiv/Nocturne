export function aiJobRetryDelaySeconds(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(300, 5 * 2 ** (normalizedAttempt - 1));
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
  if (message.includes("ai job api failed")) return "worker_api_failure";

  const normalizedName = error.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return normalizedName && normalizedName !== "error" ? normalizedName.slice(0, 128) : "ai_job_failed";
}
