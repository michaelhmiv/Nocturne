import { describe, expect, it } from "vitest";
import { normalizePlayerEffectEvent } from "./player-effect-store.js";

const actorId = "796343ee-dec7-4c5c-9eae-96db17ddf7c7";
const eventId = "ab1ff565-d3df-406d-a363-d1864c031eb4";

function normalize(payload: Record<string, unknown>, eventType = "consumption_resolved") {
  return normalizePlayerEffectEvent({
    eventId,
    actorId,
    eventType,
    occurredAt: "2026-08-02T14:01:55.408Z",
    payload,
  });
}

describe("player effect normalization", () => {
  it("preserves consumption resources, conditions, risks, and quantity", () => {
    const event = normalize({
      playerSummary: "The insects provide a modest amount of nourishment.",
      consumption: {
        sourceId: "70000000-0000-4000-8000-000000000001",
        displayName: "nutritious insects",
        unitsConsumed: 1,
        remainingUnits: 0,
        resourceDeltas: [
          { resource: "satiety", delta: 3, rationale: "The insects contain usable calories." },
        ],
        conditions: [
          {
            key: "protein_boost",
            name: "Protein boost",
            intensity: 1,
            expiresAt: "2026-08-02T15:01:55.408Z",
            rationale: "A small short-lived nutritional benefit.",
          },
        ],
        risks: [{ description: "Minor contamination", occurred: false }],
      },
    });

    expect(event.summary).toContain("modest amount");
    expect(event.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "resource_changed", resource: "satiety", delta: 3 }),
        expect.objectContaining({
          type: "condition_changed",
          conditionKey: "protein_boost",
          change: "applied",
        }),
        expect.objectContaining({
          type: "risk_resolved",
          description: "Minor contamination",
          occurred: false,
        }),
        expect.objectContaining({
          type: "quantity_changed",
          name: "nutritious insects",
          delta: -1,
          after: 0,
          change: "consumed",
        }),
      ]),
    );
  });

  it("normalizes movement and relationships from operation receipts", () => {
    const event = normalize(
      {
        operationResults: [
          {
            type: "move_entity",
            entityId: actorId,
            previousLocationId: "10000000-0000-4000-8000-000000000001",
            destinationId: "10000000-0000-4000-8000-000000000002",
            destinationName: "Foundry Row",
          },
          {
            type: "set_relation",
            targetEntityId: "50000000-0000-4000-8000-000000000001",
            relationType: "trusted_by",
          },
        ],
      },
      "travel_arrived",
    );

    expect(event.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "location_changed",
          entityId: actorId,
          toLocationName: "Foundry Row",
        }),
        expect.objectContaining({
          type: "relationship_changed",
          relationship: "trusted_by",
          change: "set",
        }),
      ]),
    );
  });
});
