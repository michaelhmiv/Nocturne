import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AiProviderClient,
  AiProviderError,
  OpenRouterClient,
  type AiProviderTelemetry,
} from "../src/index.js";

const request = {
  task: "normalize_content" as const,
  system: "Return validated mechanics only.",
  prompt: "Draft a sensor.",
  jsonSchema: {
    name: "draft",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        note: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tags"],
      additionalProperties: false,
    },
  },
  validator: z.object({ name: z.string(), note: z.string().optional(), tags: z.array(z.string()) }),
};

function errorCode(error: unknown) {
  expect(error).toBeInstanceOf(AiProviderError);
  return (error as AiProviderError).code;
}

const success = (model: string, id = "run-1") =>
  Response.json({
    id,
    model,
    choices: [{ message: { content: '{"name":"Parallax Array","note":null,"tags":[]}' } }],
  });

afterEach(() => vi.unstubAllGlobals());

describe("AiProviderClient", () => {
  it("keeps the legacy OpenRouterClient alias", () => {
    expect(new OpenRouterClient({ apiKey: "x", fallbackModel: "openai/gpt-4.1-mini" })).toBeInstanceOf(
      AiProviderClient,
    );
  });

  it("returns a typed configuration error only when invoked", async () => {
    const client = new AiProviderClient({});
    await expect(client.generateStructured(request, 0)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "configuration",
    );
  });

  it("uses a configured OpenRouter model when DeepSeek is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("openai/gpt-4.1-mini"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AiProviderClient({
      apiKey: "test-key",
      fallbackModel: "openai/gpt-4.1-mini",
    }).generateStructured(request, 0);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("openai/gpt-4.1-mini");
    expect(body.response_format.json_schema.strict).toBe(false);
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
    expect(result.provider).toBe("openrouter");
    expect(result.requestedModel).toBe("openai/gpt-4.1-mini");
  });

  it("uses DeepSeek json_object mode with an explicit JSON-only instruction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("deepseek-v4-flash", "deepseek-run-1"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AiProviderClient({ deepseekApiKey: "deepseek-key" }).generateStructured(
      request,
      0,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toMatch(/exactly one valid JSON object/i);
    expect(body.plugins).toBeUndefined();
    expect(result.provider).toBe("deepseek");
  });

  it("falls back to an explicitly configured OpenRouter model after a transient DeepSeek failure", async () => {
    const telemetry: AiProviderTelemetry[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { message: "temporary upstream failure" } }, { status: 503 }),
      )
      .mockResolvedValueOnce(success("openai/gpt-4.1-mini", "fallback-run"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AiProviderClient({
      deepseekApiKey: "deepseek-key",
      apiKey: "openrouter-key",
      fallbackModel: "openai/gpt-4.1-mini",
      logger: (entry) => telemetry.push(entry),
    }).generateStructured(request, 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(fallbackBody.model).toBe("openai/gpt-4.1-mini");
    expect(result.provider).toBe("openrouter");
    expect(telemetry.map((entry) => entry.status)).toEqual(["error", "success"]);
  });

  it("does not fall back for a permanent provider rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { message: "invalid request" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiProviderClient({
        deepseekApiKey: "deepseek-key",
        apiKey: "openrouter-key",
        fallbackModel: "openai/gpt-4.1-mini",
      }).generateStructured(request, 0),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "provider_rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries malformed structured output on the same provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          model: "openai/gpt-4.1-mini",
          choices: [{ message: { content: "not-json" } }],
        }),
      )
      .mockResolvedValueOnce(success("openai/gpt-4.1-mini"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiProviderClient({
        apiKey: "openrouter-key",
        fallbackModel: "openai/gpt-4.1-mini",
      }).generateStructured(request, 1),
    ).resolves.toMatchObject({ data: { name: "Parallax Array", tags: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors caller abort signals", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));

    await expect(
      new AiProviderClient({
        apiKey: "openrouter-key",
        fallbackModel: "openai/gpt-4.1-mini",
      }).generateStructured({ ...request, signal: controller.signal }, 0),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "aborted");
  });
});
