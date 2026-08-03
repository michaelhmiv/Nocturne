import { AiProviderError, DEEPSEEK_FLASH_MODEL } from "@nocturne/ai-gm";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("API boot paths", () => {
  it("boots and reports DeepSeek Flash configuration", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete process.env.DEEPSEEK_API_KEY;
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "api",
      ai: {
        primaryProvider: "deepseek",
        primaryConfigured: false,
        model: DEEPSEEK_FLASH_MODEL,
      },
    });
    expect(app.hasRoute({ method: "GET", url: "/ready" })).toBe(true);
    await app.close();
  });

  it("registers the consequential action routes", async () => {
    process.env.DATABASE_URL = "postgresql://test:***@127.0.0.1:5432/test";
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const app = await buildApp();

    expect(app.hasRoute({ method: "GET", url: "/v1/actions" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/actions" })).toBe(true);
    await app.close();
  });

  it("registers the conversational message and history routes", async () => {
    process.env.DATABASE_URL = "postgresql://test:***@127.0.0.1:5432/test";
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const app = await buildApp();

    expect(app.hasRoute({ method: "POST", url: "/v1/conversations/:id/messages" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/conversations/:id/messages" })).toBe(true);
    await app.close();
  });

  it("does not expose provider error details", async () => {
    process.env.DATABASE_URL = "postgresql://test:***@127.0.0.1:5432/test";
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const app = await buildApp();
    const secret = "hidden-attacker-controlled-value";
    app.get("/test-provider-error", async () => {
      throw new AiProviderError("validation", `Validation failed for ${secret}`);
    });

    const response = await app.inject({ method: "GET", url: "/test-provider-error" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: "schema_validation_error",
      message: "AI provider returned an invalid response.",
    });
    expect(response.body).not.toContain(secret);
    await app.close();
  });

  it("fails clearly at startup without required auth/database configuration", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;

    await expect(buildApp()).rejects.toThrow(/DATABASE_URL/);
  });
});
