import {
  EngineDecisionSchema,
  EngineIntentSchema,
  type EngineDecision,
  type EngineIntent,
} from "@nocturne/contracts";
import { bindIntent } from "./bind.js";
import { planOperations, playerFacts, rationale, withClarification } from "./plan.js";
import type { WorldEnginePorts } from "./ports.js";

export function createWorldEngine(ports: WorldEnginePorts) {
  return {
    async decide(input: EngineIntent): Promise<EngineDecision> {
      const intent = EngineIntentSchema.parse(input);
      const bind = await bindIntent(intent, ports);
      const operations = planOperations(intent, bind);
      const clarification = withClarification({
        status: bind.status,
        conflictNames: bind.conflictNames,
      });
      return EngineDecisionSchema.parse({
        intent,
        status: bind.status,
        target: bind.target,
        conflictNames: bind.conflictNames,
        operations,
        playerVisibleFacts: playerFacts(intent, bind),
        rationale: rationale(intent, bind),
        ...clarification,
      });
    },
  };
}

export type WorldEngine = ReturnType<typeof createWorldEngine>;
