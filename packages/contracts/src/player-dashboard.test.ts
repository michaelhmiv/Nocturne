import { describe, expect, it } from "vitest";
import { PlayerDashboardSchema } from "./player-dashboard.js";

const actorId = "796343ee-dec7-4c5c-9eae-96db17ddf7c7";
const worldId = "00000000-0000-4000-8000-000000000001";
const shardId = "00000000-0000-4000-8000-000000000002";

describe("player dashboard contract", () => {
  it("keeps current state, persistent scene, and history in one player-safe projection", () => {
    const dashboard = PlayerDashboardSchema.parse({
      character: {
        characterId: actorId,
        definitionId: "CHAR-TEST",
        name: "Rook",
        conceptSummary: "A street-level investigator.",
        version: 4,
        simulationVersion: 2,
        lifecycleStatus: "active",
        condition: 94,
        locationId: "10000000-0000-4000-8000-000000000005",
        residenceId: "10000000-0000-4000-8000-000000000005",
        cashOnPerson: 50000,
        heat: 1,
        warrant: false,
        status: "active",
        resources: [{ key: "satiety", label: "Satiety", value: 12 }],
        activeConditions: [],
        skills: { investigation: 2 },
        factionStanding: {},
        inventory: [],
      },
      scene: {
        worldId,
        shardId,
        actorId,
        location: {
          locationId: "10000000-0000-4000-8000-000000000005",
          name: "Ashdown Apartments, Unit 3B",
          hierarchy: [],
        },
        nearbyEntities: [],
        accompanyingEntities: [],
        knownEntities: [],
        activePlan: null,
        scheduledWork: [],
        recentEvents: [],
        runtimeVersion: "persistent-world-v1",
      },
      effects: {
        actorId,
        events: [],
        generatedAt: "2026-08-02T14:30:00.000Z",
      },
      resourceHistory: [
        {
          resource: "satiety",
          label: "Satiety",
          points: [
            {
              eventId: "ab1ff565-d3df-406d-a363-d1864c031eb4",
              occurredAt: "2026-08-02T14:01:55.408Z",
              delta: 3,
              after: 12,
              summary: "Consumed nutritious insects.",
            },
          ],
        },
      ],
      generatedAt: "2026-08-02T14:30:00.000Z",
    });

    expect(dashboard.character.resources[0]).toMatchObject({ key: "satiety", value: 12 });
    expect(dashboard.resourceHistory[0]?.points[0]?.delta).toBe(3);
  });
});
