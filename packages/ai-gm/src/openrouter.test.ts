import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenRouterClient } from "./openrouter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouterClient structured failover", () => {
  it("fails over after the first schema-invalid primary response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "deepseek-invalid",
            model: "deepseek-v4-flash",
            choices: [{ message: { content: JSON.stringify({ unexpected: true }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "openrouter-valid",
            model: "openai/gpt-4.1-mini",
            choices: [{ message: { content: JSON.stringify({ value: "ok" }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenRouterClient({
      deepseekApiKey: "deepseek-test-key",
      apiKey: "openrouter-test-key",
      fallbackModel: "openai/gpt-4.1-mini",
    });

    const result = await client.generateStructured({
      task: "parse_intent",
      system: "Return the requested object.",
      prompt: "Return value ok.",
      jsonSchema: {
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "string" } },
        },
      },
      validator: z.object({ value: z.string() }),
    });

    expect(result.data).toEqual({ value: "ok" });
    expect(result.provider).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
