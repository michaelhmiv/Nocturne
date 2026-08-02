import { describe, expect, it } from "vitest";
import { PlayerDashboardSchema } from "../../packages/contracts/src/index.js";
import { normalizePlayerEffectEvent } from "../../packages/database/src/player-effect-store.js";

const actorId = "796343ee-dec7-4c5c-9eae-96db17ddf7c7";
const eventId = "ab1ff565-d3df-406d-a363-d1864c031eb4";
const sourceId = "70000000-0000-4000-8000-000000000001";
const locationId = "10000000-0000-4000-8000-000000000005";
const worldId = "00000000-0000-4000-8000-000000000001";
const shardId = "00000000-0000-4000-8000-000000000002";

function committedConsumptionEvent() {
  return normalizePlayerEffectEvent({
    eventId,
    actorId,
    eventType: "consumption_resolved",
    occurredAt: "2026-08-02T14:01:55.408Z",
    payload: {
      playerSummary: "The nutritious insects take the edge off your hunger.",
      consumption: {
        sourceType: "ambient_pool",
        sourceId,
        displayName: "nutritious insects",
        unitsConsumed: 1,
        remainingUnits: 0,
        resourceDeltas: [
          {
            resource: "satiety",
            delta: 3,
            before: 9,
            after: 12,
            rationale: "The insects provide a modest amount of usable nutrition.",
          },
        ],
        conditions: [],
        risks: [{ description: "Minor contamination", occurred: false }],
      },
    },
  });
}

describe("dashboard effect consistency", () => {
  it("shows one committed consumption change in current state and history", () => {
    const event = committedConsumptionEvent();
    const dashboard = PlayerDashboardSchema.parse({
      character: {
        characterId: actorId,
        definitionId: "CHAR-CERTIFICATION",
        name: "Rook",
        conceptSummary: "A street-level investigator.",
        version: 7,
        simulationVersion: 2,
        lifecycleStatus: "active",
        condition: 100,
        locationId,
        residenceId: locationId,
        cashOnPerson: 50000,
        heat: 0,
        warrant: false,
        status: "active",
        resources: [
          { key: "satiety", label: "Satiety", value: 12, minimum: -100, maximum: 100 },
        ],
        activeConditions: [],
        skills: {},
        factionStanding: {},
        inventory: [],
      },
      scene: {
        worldId,
        shardId,
        actorId,
        location: { locationId, name: "Ashdown Apartments, Unit 3B", hierarchy: [] },
        nearbyEntities: [],
        accompanyingEntities: [],
        knownEntities: [],
        activePlan: null,
        scheduledWork: [],
        recentEvents: [
          {
            eventId,
            eventType: "consumption_resolved",
            occurredAt: event.occurredAt,
            summary: event.summary,
          },
        ],
        runtimeVersion: "persistent-world-v1",
      },
      effects: {
        actorId,
        events: [event],
        generatedAt: "2026-08-02T14:02:00.000Z",
      },
      resourceHistory: [
        {
          resource: "satiety",
          label: "Satiety",
          points: [
            {
              eventId,
              occurredAt: event.occurredAt,
              delta: 3,
              after: 12,
              summary: event.summary,
            },
          ],
        },
      ],
      generatedAt: "2026-08-02T14:02:00.000Z",
    });

    const effect = dashboard.effects.events[0]?.effects.find(
      (candidate) => candidate.type === "resource_changed" && candidate.resource === "satiety",
    );
    expect(effect).toMatchObject({ delta: 3, before: 9, after: 12 });
    expect(dashboard.character.resources[0]?.value).toBe(12);
    expect(dashboard.resourceHistory[0]?.points[0]).toMatchObject({
      eventId,
      delta: 3,
      after: 12,
    });
    expect(dashboard.scene.recentEvents[0]?.eventId).toBe(eventId);
  });

  it("does not manufacture a state change for an event with no committed effects", () => {
    const event = normalizePlayerEffectEvent({
      eventId,
      actorId,
      eventType: "dialogue_resolved",
      occurredAt: "2026-08-02T14:01:55.408Z",
      payload: { playerSummary: "You exchange a few guarded words." },
    });

    expect(event.effects).toEqual([]);
    expect(event.summary).toBe("You exchange a few guarded words.");
  });

  it("links movement history to the same authoritative event", () => {
    const destinationId = "10000000-0000-4000-8000-000000000006";
    const event = normalizePlayerEffectEvent({
      eventId,
      actorId,
      eventType: "travel_arrived",
      occurredAt: "2026-08-02T14:01:55.408Z",
      payload: {
        operationResults: [
          {
            type: "move_entity",
            entityId: actorId,
            previousLocationId: locationId,
            destinationId,
            destinationName: "Rear Alley",
          },
        ],
      },
    });

    expect(event.effects).toContainEqual(
      expect.objectContaining({
        type: "location_changed",
        entityId: actorId,
        fromLocationId: locationId,
        toLocationId: destinationId,
        toLocationName: "Rear Alley",
      }),
    );
  });
});
