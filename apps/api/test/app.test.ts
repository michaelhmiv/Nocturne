import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("API boot paths", () => {
  it("boots and reports optional OpenRouter configuration as absent", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete process.env.OPENROUTER_API_KEY;
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "api",
      openRouterConfigured: false,
    });
    await app.close();
  });

  it("fails clearly at startup without required auth/database configuration", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;

    await expect(buildApp()).rejects.toThrow(/DATABASE_URL/);
  });
});
