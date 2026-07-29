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

  it("requests provider-compatible JSON Schema, defaults to openrouter/free, and records the actual model", async () => {
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

    expect(body.model).toBe("openrouter/free");
    expect(body.max_tokens).toBe(1024);
    expect(body.response_format.json_schema.strict).toBe(false);
    expect(body.provider.require_parameters).toBe(true);
    expect(result.actualModel).toBe("provider/actual-free-model");
    expect(result.data).toEqual({ name: "Parallax Array", tags: [] });
    expect(result.providerRequestId).toBe("run-1");
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
