import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiProviderClient, DEEPSEEK_FLASH_MODEL, resolveAiProviderConfigFromEnv } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => ({
  task: "parse_intent" as const,
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

function providerResponse(content: string, id = "deepseek-response", finishReason = "stop") {
  return new Response(
    JSON.stringify({
      id,
      model: DEEPSEEK_FLASH_MODEL,
      choices: [{ finish_reason: finishReason, message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("AiProviderClient structured requests", () => {
  it("uses the direct DeepSeek Flash JSON endpoint by default and builds valid examples", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        providerResponse(JSON.stringify({ value: "ok", count: 1 }), "deepseek-valid"),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured(request());

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

  it("accepts a provider JSON object wrapped in a Markdown fence", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(providerResponse('```json\n{"value":"ok","count":1}\n```'));
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured(request());

    expect(result.data).toEqual({ value: "ok", count: 1 });
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts one balanced JSON object from provider reasoning or commentary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        providerResponse(
          '<think>I should obey the schema.</think>\nHere is the object:\n{"value":"ok","count":1}\nDone.',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured(request());

    expect(result.data).toEqual({ value: "ok", count: 1 });
    expect(result.attempts).toBe(1);
  });

  it("uses a strict correction prompt after malformed structured content", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse("I forgot to return JSON.", "malformed"))
      .mockResolvedValueOnce(
        providerResponse(JSON.stringify({ value: "ok", count: 1 }), "repaired"),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiProviderClient({ deepseekApiKey: "deepseek-test-key" });
    const result = await client.generateStructured(request());

    expect(result.data).toEqual({ value: "ok", count: 1 });
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages[1].content).toContain("CORRECTION REQUIRED");
    expect(secondBody.messages[1].content).toContain("Start with { and end with }");
    expect(secondBody.messages[1].content).not.toContain("I forgot to return JSON");
  });

  it("can switch to another OpenAI-compatible provider and model without code changes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "compatible-valid",
          model: "provider-model-v2",
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

    const client = new AiProviderClient({
      provider: "openai_compatible",
      apiKey: "compatible-key",
      baseUrl: "https://provider.example/v1/",
      model: "provider-model-v2",
      authoritativeModel: "provider-model-v2",
      creativeModel: "provider-model-v2",
      thinkingMode: "omit",
    });
    const result = await client.generateStructured(request());

    expect(result.provider).toBe("openai_compatible");
    expect(result.requestedModel).toBe("provider-model-v2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://provider.example/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("provider-model-v2");
    expect(body).not.toHaveProperty("thinking");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("resolves Railway-style environment variables", () => {
    const configuration = resolveAiProviderConfigFromEnv({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "deepseek/deepseek-v4-flash",
      AI_API_KEY: "test-key",
      AI_THINKING_MODE: "omit",
      AI_MAX_TOKENS: "8192",
      AI_TIMEOUT_MS: "90000",
      AI_HTTP_REFERER: "https://nocturne.example",
      AI_APP_TITLE: "Nocturne",
    });

    expect(configuration.provider).toBe("openrouter");
    expect(configuration.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(configuration.model).toBe("deepseek/deepseek-v4-flash");
    expect(configuration.maxTokens).toBe(8192);
    expect(configuration.timeoutMs).toBe(90000);
    expect(configuration.extraHeaders).toEqual({
      "HTTP-Referer": "https://nocturne.example",
      "X-Title": "Nocturne",
    });
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
