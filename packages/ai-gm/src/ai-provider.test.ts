import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiProviderClient, DEEPSEEK_FLASH_MODEL } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiProviderClient DeepSeek Flash request", () => {
  it("uses only the direct DeepSeek Flash JSON endpoint and builds valid examples", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "deepseek-valid",
          model: DEEPSEEK_FLASH_MODEL,
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ value: "ok", count: 1 }) },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured({
      task: "parse_intent",
      system: "Return the requested object.",
      prompt: "Return value ok.",
      jsonSchema: {
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["value", "count"],
          properties: {
            value: { type: "string", minLength: 1 },
            count: { type: "integer", minimum: 1 },
          },
        },
      },
      validator: z.object({ value: z.string(), count: z.number().int().min(1) }),
    });

    expect(result.data).toEqual({ value: "ok", count: 1 });
    expect(result.provider).toBe("deepseek");
    expect(result.requestedModel).toBe(DEEPSEEK_FLASH_MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer deepseek-test-key");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEEPSEEK_FLASH_MODEL);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("plugins");
    expect(body).not.toHaveProperty("provider");
    expect(body.messages[0].content).toContain('"count":1');
  });

  it("uses the validation error and prior JSON for one targeted repair attempt", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "deepseek-invalid",
            model: DEEPSEEK_FLASH_MODEL,
            choices: [{ message: { content: JSON.stringify({ count: 0 }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "deepseek-repaired",
            model: DEEPSEEK_FLASH_MODEL,
            choices: [{ message: { content: JSON.stringify({ count: 1 }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured({
      task: "parse_intent",
      system: "Return the requested object.",
      prompt: "Return a positive count.",
      jsonSchema: {
        name: "positive_count",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["count"],
          properties: { count: { type: "integer", minimum: 1 } },
        },
      },
      validator: z.object({ count: z.number().int().min(1) }),
    });

    expect(result.data).toEqual({ count: 1 });
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages[1].content).toContain("CORRECTION REQUIRED");
    expect(secondBody.messages[1].content).toContain('"count":0');
  });
});
