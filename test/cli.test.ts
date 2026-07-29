import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { formatConversation, parseOptions } from "../scripts/nocturne-cli.js";
import { runScenario } from "../scripts/nocturne-scenario.js";

const response = {
  responseId: "event-1",
  narration: "The door opens.",
  plan: {
    intent: { kind: "world_action", summary: "Open the door." },
    facts: [],
    checks: [
      {
        order: 1,
        label: "Force the door",
        apparentProbability: {
          scale: "nocturne-probability-v1",
          band: "likely",
          basisPoints: 7500,
        },
        publicFactors: [
          {
            summary: "The hinges are weak.",
            probabilityDeltaBasisPoints: 500,
            citations: ["fact:hinges"],
          },
        ],
        stakes: { success: "The door opens.", failure: "It stays shut." },
      },
    ],
  },
  execution: { state: "completed" },
  outcomes: [
    {
      order: 1,
      finalProbability: {
        scale: "nocturne-probability-v1",
        band: "likely",
        basisPoints: 7500,
      },
      grade: "success",
      rollBasisPoints: 4200,
      summary: "The door opens.",
    },
  ],
};

describe("Nocturne CLI", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(() => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))));

  it("sends scripted turns with auth and idempotency, asserts JSON paths, and formats player-safe details", async () => {
    const requests: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];
    const server = createServer((request, reply) => {
      requests.push({ url: request.url!, headers: request.headers });
      reply.setHeader("content-type", "application/json");
      reply.end(JSON.stringify(response));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");
    const options = parseOptions(
      [
        "--",
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--conversation-id",
        "story",
        "--cookie",
        "session=x",
        "--guest",
        "--idempotency-key",
        "flow",
      ],
      {},
    );
    const output: string[] = [];

    await runScenario(
      [
        JSON.stringify({
          message: "I open the door.",
          assert: {
            "execution.state": "completed",
            "outcomes.0.finalProbability.basisPoints": 7500,
          },
          includes: { narration: "door opens" },
        }),
      ],
      options,
      (line) => output.push(line),
    );

    expect(requests).toEqual([
      {
        url: "/v1/conversations/story/messages",
        headers: expect.objectContaining({
          cookie: "session=x",
          "x-nocturne-guest-mode": "1",
          "idempotency-key": "flow-1",
        }),
      },
    ]);
    expect(JSON.parse(output[0]!)).toEqual(response);
    expect(formatConversation(response)).toContain(
      "Force the door — probability 75.00% (7500 bp), roll 42.00% (4200 bp), success",
    );
    expect(formatConversation(response)).toContain("factor +500 bp: The hinges are weak.");
    expect(formatConversation(response)).toContain("execution: completed\nevent: event-1");
  });
});
