import { describe, expect, it } from "vitest";
import { normalizeAiJobApiUrl, readAiJobWorkerConfig } from "../src/ai-job-config.js";

describe("AI job worker configuration", () => {
  it("adds an HTTP scheme to Railway private service references", () => {
    expect(normalizeAiJobApiUrl("nocturne-api.railway.internal:3001/")).toBe(
      "http://nocturne-api.railway.internal:3001",
    );
  });

  it("preserves explicit HTTPS URLs", () => {
    expect(normalizeAiJobApiUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("fails instead of silently disabling durable jobs", () => {
    expect(() => readAiJobWorkerConfig({ DATABASE_URL: "postgres://example" })).toThrow(
      /AI_JOB_API_URL, AI_JOB_WORKER_SECRET/,
    );
  });

  it("reads the explicit API URL and shared secret", () => {
    expect(
      readAiJobWorkerConfig({
        AI_JOB_API_URL: "api.internal:3001",
        AI_JOB_WORKER_SECRET: "shared-secret",
      }),
    ).toEqual({
      apiUrl: "http://api.internal:3001",
      workerSecret: "shared-secret",
    });
  });
});
