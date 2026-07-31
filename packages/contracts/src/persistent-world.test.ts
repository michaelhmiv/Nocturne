import { describe, expect, it } from "vitest";
import { PersistentWorldSceneSchema } from "./persistent-scene.js";
import { OperatorRepairRequestSchema } from "./world-inspector.js";
import { WorldActionPlayerSafeResultSchema } from "./world-action.js";

const worldId = "00000000-0000-4000-8000-000000000001";
const shardId = "00000000-0000-4000-8000-000000000002";
const actorId = "10000000-0000-4000-8000-000000000001";
const dogId = "10000000-0000-4000-8000-000000000002";
const kitchenId = "10000000-0000-4000-8000-000000000003";

describe("persistent world cutover contracts", () => {
  it("projects the same dog at home without leaking hidden state", () => {
    const scene = PersistentWorldSceneSchema.parse({
      worldId,
      shardId,
      actorId,
      location: {
        locationId: "10000000-0000-4000-8000-000000000004",
        name: "Front walk",
        hierarchy: [],
      },
      nearbyEntities: [],
      accompanyingEntities: [],
      knownEntities: [
        {
          entityId: dogId,
          name: "Thin brown stray",
          definitionType: "animal",
          lifecycleStatus: "active",
          locationId: kitchenId,
          locationName: "Unit 3B kitchen",
          relationshipLabels: ["resides_at"],
          aliases: ["Rufus"],
          statusSummary: "Resting",
          lastObservedAt: "2026-07-31T02:00:00.000Z",
          presence: "known_elsewhere",
        },
      ],
      activePlan: null,
      scheduledWork: [],
      recentEvents: [],
      runtimeVersion: "persistent-world-v1",
    });
    expect(scene.knownEntities[0]?.entityId).toBe(dogId);
    expect(scene.knownEntities[0]).not.toHaveProperty("state");
    expect(scene.knownEntities[0]).not.toHaveProperty("condition");
  });

  it("represents timed travel as waiting instead of a completed failure", () => {
    const waiting = WorldActionPlayerSafeResultSchema.parse({
      state: "waiting",
      requestId: "20000000-0000-4000-8000-000000000001",
      narration:
        "Travel is in progress. The dependent action remains queued for arrival revalidation.",
      plan: {
        planId: "20000000-0000-4000-8000-000000000002",
        actorId,
        status: "waiting_for_time",
        planVersion: 2,
        activeStepId: "20000000-0000-4000-8000-000000000003",
        exclusivePhysical: true,
        steps: [
          {
            stepId: "20000000-0000-4000-8000-000000000003",
            order: 1,
            kind: "move",
            description: "Travel to the street.",
            status: "waiting",
            idempotencyKey: "plan:step:1",
            waitingReason: "Arrival is scheduled.",
            outcomeGrade: null,
          },
          {
            stepId: "20000000-0000-4000-8000-000000000004",
            order: 2,
            kind: "combat",
            description: "Revalidate and attempt the attack after arrival.",
            status: "pending",
            idempotencyKey: "plan:step:2",
            waitingReason: null,
            outcomeGrade: null,
          },
        ],
        createdAt: "2026-07-31T02:00:00.000Z",
        updatedAt: "2026-07-31T02:00:01.000Z",
      },
    });
    expect(waiting.state).toBe("waiting");
    if (waiting.state !== "waiting") throw new Error("Expected a waiting world action result.");
    expect(waiting.plan.steps[1]?.status).toBe("pending");
  });

  it("requires an explicit reason and expected version for operator relocation", () => {
    const repair = OperatorRepairRequestSchema.parse({
      actionType: "relocate_entity",
      entityId: dogId,
      destinationId: kitchenId,
      expectedVersion: 8,
      reason: "Repair a location corrupted by a failed prototype event.",
    });
    expect(repair.actionType).toBe("relocate_entity");
    if (repair.actionType !== "relocate_entity") {
      throw new Error("Expected an entity relocation repair.");
    }
    expect(repair.expectedVersion).toBe(8);
  });
});
