export function aiJobRetryDelaySeconds(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(300, 5 * 2 ** (normalizedAttempt - 1));
}

export function aiJobErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 128);
  return "ai_job_failed";
}
