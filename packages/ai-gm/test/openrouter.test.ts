import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenRouterClient, OpenRouterError } from "../src/index.js";

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
  expect(error).toBeInstanceOf(OpenRouterError);
  return (error as OpenRouterError).code;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouterClient", () => {
  it("boots without a key and returns a typed configuration error only when invoked", async () => {
    const client = new OpenRouterClient({ apiKey: undefined });
    await expect(client.generateStructured(request)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "configuration",
    );
  });

  it("requests provider-compatible JSON Schema, defaults to deepseek v4 flash, and records the actual model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "run-1",
        model: "provider/actual-free-model",
        choices: [{ message: { content: '{"name":"Parallax Array","note":null}' } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient({ apiKey: "test-key" }).generateStructured(request);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.max_tokens).toBe(1024);
    expect(body.response_format.json_schema.strict).toBe(false);
    // provider fields present when using OpenRouter (no deepseek key)
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(result.actualModel).toBe("provider/actual-free-model");
    expect(result.data).toEqual({ name: "Parallax Array", tags: [] });
    expect(result.providerRequestId).toBe("run-1");
  });

  it("uses DeepSeek json_object mode with an explicit JSON-only instruction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "deepseek-run-1",
        model: "deepseek-v4-flash",
        choices: [{ message: { content: '{"name":"Parallax Array","tags":[]}' } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient({ deepseekApiKey: "deepseek-key" }).generateStructured(
      request,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toMatch(/JSON/);
    expect(body.messages[0].content).toMatch(/exactly one valid JSON object/i);
    expect(body.plugins).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(result.actualModel).toBe("deepseek-v4-flash");
    expect(result.data).toEqual({ name: "Parallax Array", tags: [] });
  });

  it.each([
    [429, "rate_limited"],
    [500, "provider_failure"],
  ] as const)("maps provider status %s to %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: "provider rejected request" } }, { status }),
        ),
    );

    await expect(
      new OpenRouterClient({ apiKey: "test-key" }).generateStructured(request),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === code);
  });

  it("maps malformed provider responses to a typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    await expect(
      new OpenRouterClient({ apiKey: "test-key" }).generateStructured(request),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "malformed_response");
  });

  it("retries one invalid structured response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          model: "provider/free-model",
          choices: [{ message: { content: "We need to answer..." } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          model: "provider/free-model",
          choices: [{ message: { content: '{"name":"Parallax Array","tags":[]}' } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenRouterClient({ apiKey: "x" }).generateStructured(request),
    ).resolves.toMatchObject({ data: { name: "Parallax Array", tags: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors caller abort signals", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));

    await expect(
      new OpenRouterClient({ apiKey: "test-key" }).generateStructured({
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === "aborted");
  });
});
