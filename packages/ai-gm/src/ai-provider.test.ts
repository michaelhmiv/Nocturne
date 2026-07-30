import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiProviderClient, DEEPSEEK_FLASH_MODEL } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiProviderClient DeepSeek Flash request", () => {
  it("uses only the direct DeepSeek Flash JSON endpoint and disables thinking", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "deepseek-valid",
          model: DEEPSEEK_FLASH_MODEL,
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ value: "ok" }) },
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
          required: ["value"],
          properties: { value: { type: "string" } },
        },
      },
      validator: z.object({ value: z.string() }),
    });

    expect(result.data).toEqual({ value: "ok" });
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
    expect(body.messages[0].content).toContain("Example JSON shape");
  });
});
