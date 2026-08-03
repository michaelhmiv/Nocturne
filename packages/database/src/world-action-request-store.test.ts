import { describe, expect, it, vi } from "vitest";
import { createWorldActionRequestStore } from "./world-action-request-store.js";

describe("world action request history", () => {
  it("returns player-safe canonical requests with ordered execution stages", async () => {
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      expect(query).toContain("FROM game.world_action_requests request");
      expect(query).toContain("LEFT JOIN game.world_action_execution_stages stage");
      expect(values).toContain("user-1");
      expect(values).toContain("40000000-0000-4000-8000-000000000001");
      return [
        {
          request_id: "50000000-0000-4000-8000-000000000001",
          actor_id: "40000000-0000-4000-8000-000000000001",
          command: "I do one push-up.",
          request_hash: "a".repeat(64),
          status: "completed",
          plan_id: "60000000-0000-4000-8000-000000000001",
          player_safe_result: {
            state: "completed",
            requestId: "50000000-0000-4000-8000-000000000001",
            plan: {
              planId: "60000000-0000-4000-8000-000000000001",
              actorId: "40000000-0000-4000-8000-000000000001",
              status: "completed",
              planVersion: 1,
              activeStepId: null,
              exclusivePhysical: true,
              steps: [],
              createdAt: "2026-08-03T15:00:00.000Z",
              updatedAt: "2026-08-03T15:00:01.000Z",
            },
            narration: "You complete one push-up.",
            eventIds: ["70000000-0000-4000-8000-000000000001"],
          },
          error_code: null,
          created_at: new Date("2026-08-03T15:00:00.000Z"),
          updated_at: new Date("2026-08-03T15:00:01.000Z"),
          completed_at: new Date("2026-08-03T15:00:01.000Z"),
          stages: [
            {
              order: 1,
              type: "compile_context",
              status: "completed",
              inputSummary: { actorId: "40000000-0000-4000-8000-000000000001" },
              outputSummary: { factCount: 2 },
              startedAt: "2026-08-03T15:00:00.000Z",
              completedAt: "2026-08-03T15:00:00.100Z",
            },
          ],
        },
      ];
    });
    const store = createWorldActionRequestStore({ client } as never);

    const history = await store.listForActor({
      userId: "user-1",
      actorId: "40000000-0000-4000-8000-000000000001",
    });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      command: "I do one push-up.",
      status: "completed",
      errorCode: null,
      playerSafeResult: { narration: "You complete one push-up." },
      stages: [{ order: 1, type: "compile_context", status: "completed" }],
    });
  });
});
