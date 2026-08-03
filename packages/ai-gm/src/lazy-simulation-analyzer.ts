import {
  LazySimulationProposalSchema,
  LazySimulationRequestSchema,
  type LazySimulationProposal,
  type LazySimulationRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const LAZY_SIMULATION_POLICY_VERSION = "lazy-simulation-v1";

const lazySimulationJsonSchema = {
  name: "nocturne_lazy_entity_simulation",
  description: "Bounded unattended entity-state development over elapsed real time.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "summary", "operations", "assumptions", "nextSimulationSeconds"],
    properties: {
      decision: { enum: ["no_change", "mutate"] },
      summary: { type: "string" },
      operations: { type: "array", maxItems: 16, items: { type: "object" } },
      assumptions: { type: "array", maxItems: 16, items: { type: "string" } },
      nextSimulationSeconds: { type: "integer", minimum: 60, maximum: 604800 },
    },
  },
} as const;

export function buildLazySimulationPrompt(input: LazySimulationRequest) {
  const parsed = LazySimulationRequestSchema.parse(input);
  return `Propose bounded authoritative changes for one unattended persistent entity after elapsed real time.

Rules:
- Prefer no_change when supplied facts do not justify a durable mutation.
- Use only the operation types allowed by the supplied policy.
- Every entity reference must target the supplied entity. Movement destinations must be in accessibleLocationIds.
- Do not create entities, definitions, items, locations, knowledge, schedules, or area effects.
- Do not grant ownership, possession, control, trust, following, access, or resources without a supplied causal fact.
- Do not move through inaccessible routes or out of secure containment.
- Bound hunger, thirst, fatigue, fear, trust, injury, rest, and other changes by elapsed time.
- Major injury, disappearance, or death requires strong supplied state/facts and enough elapsed time. Otherwise use no_change or gradual deterioration.
- Dead, destroyed, retired, or merged entities do not act.
- Do not expose hidden changes; summary is authoritative audit text, not player narration.
- Include current entity expectedVersion on every mutating operation.
- State paths may use only policy stateKeys unless the operation is movement or condition change.
- Resource operations may use only policy resourceKeys.
- nextSimulationSeconds must respect the likely rate of future meaningful change.

ENTITY:
${JSON.stringify({
  entityId: parsed.entityId,
  definitionType: parsed.definitionType,
  definitionName: parsed.definitionName,
  lifecycleStatus: parsed.lifecycleStatus,
  condition: parsed.condition,
  state: parsed.state,
  locationId: parsed.locationId,
  elapsedSeconds: parsed.elapsedSeconds,
})}

POLICY:
${JSON.stringify(parsed.policy)}

RELEVANT FACTS:
${JSON.stringify(parsed.relevantFacts)}

ACCESSIBLE LOCATIONS:
${JSON.stringify(parsed.accessibleLocationIds)}`;
}

export function validateLazySimulationProposal(
  proposal: LazySimulationProposal,
  input: LazySimulationRequest,
) {
  const parsedInput = LazySimulationRequestSchema.parse(input);
  const parsed = LazySimulationProposalSchema.parse(proposal);
  const allowedTypes = new Set(parsedInput.policy.allowedOperationTypes);
  const allowedPaths = new Set(parsedInput.policy.stateKeys);
  const allowedResources = new Set(parsedInput.policy.resourceKeys);
  for (const operation of parsed.operations) {
    if (!allowedTypes.has(operation.type)) {
      throw new Error(`Simulation proposed disallowed operation type: ${operation.type}.`);
    }
    const references = (() => {
      switch (operation.type) {
        case "move_entity":
          return [operation.entityRef];
        case "set_relation":
        case "remove_relation":
          return [operation.sourceRef];
        case "set_condition":
        case "adjust_condition":
        case "adjust_resource":
        case "set_state_value":
        case "remove_state_value":
        case "retire_entity":
        case "transfer_ownership":
        case "transfer_possession":
        case "set_controller":
          return [operation.entityRef];
        default:
          return [];
      }
    })();
    for (const reference of references) {
      if (reference.kind !== "existing" || reference.entityId !== parsedInput.entityId) {
        throw new Error("Simulation may mutate only the supplied entity.");
      }
    }
    if (operation.type === "move_entity") {
      if (
        operation.locationRef.kind !== "existing" ||
        !parsedInput.accessibleLocationIds.includes(operation.locationRef.entityId)
      ) {
        throw new Error("Simulation proposed an inaccessible movement destination.");
      }
    }
    if (
      (operation.type === "set_state_value" || operation.type === "remove_state_value") &&
      !allowedPaths.has(operation.path[0]!)
    ) {
      throw new Error("Simulation proposed a state key outside the policy.");
    }
    if (operation.type === "adjust_resource" && !allowedResources.has(operation.resource)) {
      throw new Error("Simulation proposed a resource outside the policy.");
    }
    if (
      "expectedVersion" in operation &&
      operation.expectedVersion !== undefined &&
      operation.expectedVersion !== Number(parsedInput.state.version ?? operation.expectedVersion)
    ) {
      throw new Error("Simulation proposal used a stale expected entity version.");
    }
  }
  if (
    ["dead", "destroyed", "retired", "merged"].includes(parsedInput.lifecycleStatus) &&
    parsed.operations.length
  ) {
    throw new Error("Terminal entities cannot receive autonomous action operations.");
  }
  return parsed;
}

export async function analyzeLazySimulation(
  client: Pick<AiProviderClient, "generateStructured">,
  input: LazySimulationRequest,
): Promise<StructuredGenerationResult<LazySimulationProposal>> {
  const parsedInput = LazySimulationRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "simulate_entity_elapsed_time",
    system: `You are Nocturne's bounded lazy world simulator. Policy ${LAZY_SIMULATION_POLICY_VERSION}. Propose only state changes justified by elapsed real time and supplied authoritative facts. Do not narrate to the player or mutate state directly. Output only the required structured object.`,
    prompt: buildLazySimulationPrompt(parsedInput),
    jsonSchema: lazySimulationJsonSchema,
    validator: LazySimulationProposalSchema,
  });
  return { ...result, data: validateLazySimulationProposal(result.data, parsedInput) };
}
