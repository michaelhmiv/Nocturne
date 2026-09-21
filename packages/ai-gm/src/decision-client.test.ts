import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiDecisionClient,
  DEFAULT_DECISION_ENDPOINT,
  DEFAULT_DECISION_MODEL,
  resolveAiDecisionConfigFromEnv,
} from "./decision-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiDecisionClient", () => {
  it("uses the OpenRouter Decisions endpoint and validates typed answers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "decision-1",
          model: "typesafe/jev-1.13-20260917",
          answers: {
            intent: {
              type: "choice",
              choice: "interact",
              confidence: 0.97,
              probabilities: { interact: 0.97, dialogue: 0.03 },
            },
            needs_clarification: { type: "noul", noul: 0.02 },
            danger: {
              type: "score",
              score: 1.2,
              confidence: 0.8,
              probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
            },
          },
          usage: { input_tokens: 123, output_tokens: 12, cost: 0.00001 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AiDecisionClient({ apiKey: "openrouter-test-key" });
    const result = await client.decide({
      task: "route_world_action",
      state: { command: "open the door" },
      questions: {
        intent: {
          type: "choice",
          instructions: "What is the terminal action?",
          criteria: {
            interact: "Interact physically with something.",
            dialogue: "Speak to someone.",
          },
        },
        needs_clarification: {
          type: "noul",
          instructions: "Does the command require clarification?",
        },
        danger: {
          type: "score",
          instructions: "How dangerous is the requested action?",
          criteria: ["Ordinary and low-risk.", "Meaningful risk.", "Severe risk."],
        },
      },
    });

    expect(result.actualModel).toBe("typesafe/jev-1.13-20260917");
    expect(result.answers.intent.choice).toBe("interact");
    expect(result.answers.needs_clarification.noul).toBe(0.02);
    expect(result.answers.danger.score).toBe(1.2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(DEFAULT_DECISION_ENDPOINT);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer openrouter-test-key",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEFAULT_DECISION_MODEL);
    expect(body.questions.intent.type).toBe("choice");
  });

  it("resolves Jev configuration from the existing OpenRouter secret", () => {
    const config = resolveAiDecisionConfigFromEnv({
      OPENROUTER_API_KEY: "secret",
      AI_DECISION_MODEL: "~typesafe/jev-latest",
      AI_DECISION_TIMEOUT_MS: "2500",
      AI_HTTP_REFERER: "https://nocturne.example",
      AI_APP_TITLE: "Nocturne",
    });

    expect(config.apiKey).toBe("secret");
    expect(config.model).toBe("~typesafe/jev-latest");
    expect(config.timeoutMs).toBe(2500);
    expect(config.extraHeaders).toEqual({
      "HTTP-Referer": "https://nocturne.example",
      "X-Title": "Nocturne",
    });
  });

  it("rejects a choice outside the supplied answer space", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "typesafe/jev-1.13",
            answers: {
              intent: { type: "choice", choice: "invented" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const client = new AiDecisionClient({ apiKey: "openrouter-test-key" });
    await expect(
      client.decide({
        task: "route_world_action",
        state: "test",
        questions: {
          intent: {
            type: "choice",
            instructions: "Choose one.",
            criteria: { interact: "Interact." },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
