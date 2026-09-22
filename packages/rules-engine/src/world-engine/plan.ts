import {
  type EngineDecision,
  type EngineIntent,
  isMutatingPrimitive,
  type UniversalWorldOperation,
} from "@nocturne/contracts";
import type { BindResult } from "./bind.js";

export function planOperations(intent: EngineIntent, bind: BindResult): UniversalWorldOperation[] {
  if (
    bind.status === "need_source" ||
    bind.status === "unsupported" ||
    bind.status === "impossible" ||
    bind.status === "clarify_known_conflict" ||
    !bind.actor
  ) {
    return [];
  }

  if (!isMutatingPrimitive(intent.primitive)) {
    return [];
  }

  if (intent.primitive === "travel") {
    return planTravel(intent, bind);
  }

  if (intent.primitive === "occupy" && bind.target?.entityId) {
    return [
      {
        type: "set_relation",
        sourceRef: { kind: "existing", entityId: intent.actorId },
        targetRef: { kind: "existing", entityId: bind.target.entityId },
        relationType: "seated_in",
        parameters: {},
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "transfer") {
    const itemId = intent.explicitEntityIds[0];
    if (!itemId) return [];
    return [
      {
        type: "transfer_possession",
        entityRef: { kind: "existing", entityId: itemId },
        possessorRef: { kind: "existing", entityId: intent.actorId },
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "consume") {
    const itemId = intent.explicitEntityIds[0] || bind.actor?.possessedIds[0];
    if (!itemId) return [];
    return [
      {
        type: "adjust_resource",
        entityRef: { kind: "existing", entityId: intent.actorId },
        resource: "nutrition",
        delta: 10,
        minimum: 0,
        maximum: 100,
        expectedVersion: bind.actor?.version,
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "wait" || intent.primitive === "work") {
    return [
      {
        type: "schedule_timed_work",
        kind: intent.primitive === "work" ? "labor" : "wait",
        subjectRefs: [{ kind: "existing", entityId: intent.actorId }],
        description: intent.rawText,
        durationSeconds: intent.constraints.durationSeconds || 120,
        payload: { worldId: intent.worldId, shardId: intent.shardId },
        expectedVersions: {},
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "communicate" && bind.target?.entityId) {
    return [
      {
        type: "create_information_asset",
        holderRef: { kind: "existing", entityId: bind.target.entityId },
        subjectRef: { kind: "existing", entityId: intent.actorId },
        content: intent.rawText,
        confidenceBasisPoints: 8000,
        truthStatus: "observation",
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "operate" && intent.category === "item.weapon") {
    const weaponId = intent.explicitEntityIds[0] || bind.actor?.possessedIds[0];
    if (!weaponId) return [];
    return [
      {
        type: "adjust_resource",
        entityRef: { kind: "existing", entityId: weaponId },
        resource: "ammunition",
        delta: -1,
        minimum: 0,
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "damage") {
    const targetId = intent.explicitEntityIds[0] || bind.target?.entityId;
    if (!targetId) return [];
    return [
      {
        type: "adjust_condition",
        entityRef: { kind: "existing", entityId: targetId },
        delta: -20,
        preconditionFactIds: [],
      },
    ];
  }

  if (intent.primitive === "restrain" && bind.target?.entityId) {
    return [
      {
        type: "set_relation",
        sourceRef: { kind: "existing", entityId: bind.target.entityId },
        targetRef: { kind: "existing", entityId: intent.actorId },
        relationType: "detained_by",
        parameters: { faction: "police" },
        preconditionFactIds: [],
      },
    ];
  }

  if (
    intent.primitive === "operate" &&
    intent.category === "vehicle.automobile" &&
    bind.target?.entityId
  ) {
    return [
      {
        type: "adjust_resource",
        entityRef: { kind: "existing", entityId: bind.target.entityId },
        resource: "fuel",
        delta: -1,
        minimum: 0,
        preconditionFactIds: [],
      },
    ];
  }

  return [];
}

function planTravel(intent: EngineIntent, bind: BindResult): UniversalWorldOperation[] {
  const operations: UniversalWorldOperation[] = [];
  const destinationSymbol = "destination";
  if (bind.status === "materialize_from_source" && bind.target?.sourceKey) {
    operations.push({
      type: "create_instance",
      symbol: destinationSymbol,
      definitionRef: { kind: "existing", definitionId: bind.target.family || "place" },
      condition: 100,
      state: {
        sourceKey: bind.target.sourceKey,
        name: bind.target.name,
        family: bind.target.family,
      },
      provenance: {
        sourceType: "ai_materialization",
        sourceId: bind.target.sourceKey,
        payload: { family: bind.target.family },
      },
      preconditionFactIds: [],
    });
    operations.push({
      type: "move_entity",
      entityRef: { kind: "existing", entityId: intent.actorId },
      locationRef: { kind: "symbol", symbol: destinationSymbol },
      expectedVersion: bind.actor?.version,
      preconditionFactIds: [],
    });
    return operations;
  }

  if (bind.target?.entityId) {
    operations.push({
      type: "move_entity",
      entityRef: { kind: "existing", entityId: intent.actorId },
      locationRef: { kind: "existing", entityId: bind.target.entityId },
      expectedVersion: bind.actor?.version,
      preconditionFactIds: [],
    });
  }
  return operations;
}

export function playerFacts(intent: EngineIntent, bind: BindResult): string[] {
  if (bind.status === "need_source") {
    return ["No matching place exists in the loaded city source for that category."];
  }
  if (bind.status === "impossible") {
    return ["The action is not possible from the actor's current body or possessions."];
  }
  if (bind.status === "clarify_known_conflict") {
    return [`More than one known place matches: ${bind.conflictNames.join(", ")}.`];
  }
  if (intent.primitive === "perceive") {
    return ["The actor inspects currently known body and money state."];
  }
  if (bind.target?.name && intent.primitive === "travel") {
    const mode = intent.travelMode || "walk";
    return [`Travel ${mode} toward ${bind.target.name}.`];
  }
  if (intent.primitive === "transfer") {
    return ["Possession moves to the actor if stock and payment allow."];
  }
  if (intent.primitive === "occupy" && bind.target?.name) {
    return [`Occupy ${bind.target.name}.`];
  }
  if (intent.primitive === "operate" && intent.category === "item.weapon") {
    return ["Discharge a possessed weapon."];
  }
  if (intent.primitive === "restrain") {
    return ["An authorized actor restrains the target."];
  }
  return [];
}

export function rationale(intent: EngineIntent, bind: BindResult): string {
  return `primitive=${intent.primitive} status=${bind.status} selector=${intent.selector}`;
}

export function withClarification(decision: {
  status: BindResult["status"];
  conflictNames: string[];
}): Pick<EngineDecision, "requiresClarification" | "clarificationPrompt"> {
  if (decision.status !== "clarify_known_conflict") {
    return { requiresClarification: false };
  }
  return {
    requiresClarification: true,
    clarificationPrompt: `Did you mean ${decision.conflictNames.join(" or ")}?`,
  };
}
