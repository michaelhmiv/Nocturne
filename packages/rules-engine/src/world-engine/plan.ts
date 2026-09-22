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
