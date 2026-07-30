export type AiJobWorkerConfig = {
  apiUrl: string;
  workerSecret: string;
};

export function normalizeAiJobApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AI_JOB_API_URL must use http or https.");
  }
  return normalized.replace(/\/+$/, "");
}

export function readAiJobWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiJobWorkerConfig {
  const apiUrl = normalizeAiJobApiUrl(
    environment.AI_JOB_API_URL ||
      environment.API_URL ||
      environment.RAILWAY_SERVICE__NOCTURNE_API_URL,
  );
  const workerSecret = environment.AI_JOB_WORKER_SECRET?.trim() || "";
  const missing: string[] = [];

  if (!apiUrl) missing.push("AI_JOB_API_URL");
  if (!workerSecret) missing.push("AI_JOB_WORKER_SECRET");

  if (missing.length) {
    throw new Error(
      `AI job worker configuration is missing: ${missing.join(", ")}. ` +
        "The worker will not start because silently disabling the queue leaves player turns pending forever.",
    );
  }

  return { apiUrl, workerSecret };
}
