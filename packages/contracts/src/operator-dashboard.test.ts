import { describe, expect, it } from "vitest";
import { OperatorDashboardSchema } from "./operator-dashboard.js";

const actorId = "796343ee-dec7-4c5c-9eae-96db17ddf7c7";

describe("operator dashboard contract", () => {
  it("correlates a request with stages, plan, context, and results", () => {
    const dashboard = OperatorDashboardSchema.parse({
      actorId,
      traces: [
        {
          requestId: "9e819850-f40d-4580-b877-973644ae6db3",
          command: "I eat bugs that are nutritious",
          status: "completed",
          errorCode: null,
          planId: "17c05de9-c608-4b54-ac1b-dcfeea03c66e",
          contextCompilationId: "7a31596c-9208-41a9-8dcd-666bbe35f64e",
          authoritativeResult: { eventIds: ["ab1ff565-d3df-406d-a363-d1864c031eb4"] },
          playerSafeResult: { state: "completed" },
          createdAt: "2026-08-02T14:01:42.626Z",
          updatedAt: "2026-08-02T14:01:55.565Z",
          completedAt: "2026-08-02T14:01:55.565Z",
          stages: [
            {
              stageId: "c1111111-1111-4111-8111-111111111111",
              order: 1,
              type: "compile_context",
              status: "completed",
              inputSummary: { actorId },
              outputSummary: { factCount: 82 },
              startedAt: "2026-08-02T14:01:42.646Z",
              completedAt: "2026-08-02T14:01:42.705Z",
            },
          ],
        },
      ],
      handlers: [
        {
          actionKind: "consume",
          handlerVersion: "consumption-v4",
          authorityMode: "ai_semantic_then_deterministic",
          supportsStateChange: true,
          enabled: true,
          description: "Open-ended authoritative consumption.",
        },
      ],
      generatedAt: "2026-08-02T14:40:00.000Z",
    });

    expect(dashboard.traces[0]?.stages[0]?.outputSummary).toEqual({ factCount: 82 });
    expect(dashboard.handlers[0]?.supportsStateChange).toBe(true);
  });
});
