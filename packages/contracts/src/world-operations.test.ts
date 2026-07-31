import { describe, expect, it } from "vitest";
import {
  UniversalMutationReceiptSchema,
  UniversalWorldOperationBranchSchema,
} from "./world-operations.js";

const actor = { kind: "existing" as const, entityId: "10000000-0000-4000-8000-000000000001" };
const alley = { kind: "existing" as const, entityId: "10000000-0000-4000-8000-000000000002" };

describe("universal world operations", () => {
  it("supports symbolic creation followed by persistent relations", () => {
    const branch = UniversalWorldOperationBranchSchema.parse({
      operations: [
        {
          type: "create_definition",
          symbol: "dog_definition",
          definitionType: "animal",
          name: "Mixed-breed domestic dog",
          conceptSummary: "A durable, unique domestic dog entity.",
          lifecycleStatus: "approved",
          preconditionFactIds: ["fact:reservoir"],
        },
        {
          type: "create_instance",
          symbol: "found_dog",
          definitionRef: { kind: "symbol", symbol: "dog_definition" },
          locationRef: alley,
          condition: 82,
          state: { appearance: "thin brown stray" },
          provenance: {
            sourceType: "population_reservoir",
            sourceId: "reservoir:urban-animals",
            policyVersion: "materialization-v1",
            payload: {},
          },
          preconditionFactIds: ["fact:search_succeeded"],
        },
        {
          type: "set_relation",
          sourceRef: actor,
          targetRef: { kind: "symbol", symbol: "found_dog" },
          relationType: "observed",
          parameters: { visibility: "player_known" },
          preconditionFactIds: ["fact:search_succeeded"],
        },
      ],
    });

    expect(branch.operations).toHaveLength(3);
    expect(branch.operations[1]?.type).toBe("create_instance");
  });

  it("rejects duplicate symbols in one operation branch", () => {
    expect(() =>
      UniversalWorldOperationBranchSchema.parse({
        operations: [
          {
            type: "create_definition",
            symbol: "duplicate",
            definitionType: "animal",
            name: "Dog",
            conceptSummary: "A dog.",
            preconditionFactIds: [],
          },
          {
            type: "create_definition",
            symbol: "duplicate",
            definitionType: "animal",
            name: "Another dog",
            conceptSummary: "Another dog.",
            preconditionFactIds: [],
          },
        ],
      }),
    ).toThrow(/symbols must be unique/i);
  });

  it("validates replayable mutation receipts", () => {
    const receipt = UniversalMutationReceiptSchema.parse({
      receiptId: "20000000-0000-4000-8000-000000000001",
      eventId: "20000000-0000-4000-8000-000000000002",
      worldId: "20000000-0000-4000-8000-000000000003",
      shardId: "20000000-0000-4000-8000-000000000004",
      idempotencyKey: "test:dog:1",
      requestHash: "a".repeat(64),
      authority: "player",
      actorId: actor.entityId,
      symbolMap: { found_dog: "20000000-0000-4000-8000-000000000005" },
      operationResults: [{ type: "create_instance" }],
      playerVisibleFacts: ["A dog was found."],
      hiddenFacts: [],
      createdAt: "2026-07-31T00:00:00.000Z",
      idempotentReplay: false,
    });

    expect(receipt.symbolMap.found_dog).toBeDefined();
  });
});
