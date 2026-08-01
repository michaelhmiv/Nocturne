import {
  GameConstitutionSchema,
  type AiContextConsumptionMode,
  type GameConstitution,
  type GameMasterContext,
} from "@nocturne/contracts";
import type { AiTask } from "./model-policy.js";

export const GAME_CONSTITUTION_VERSION = "nocturne-gm-constitution-v1";

export const NOCTURNE_GAME_CONSTITUTION: GameConstitution = GameConstitutionSchema.parse({
  version: GAME_CONSTITUTION_VERSION,
  purpose: [
    "Nocturne is an improvisational open-world roleplaying game where players may attempt arbitrary actions.",
    "Resolve player intent in-world whenever a coherent, bounded resolution is possible.",
    "Preserve durable causal truth while allowing flexible narrative texture.",
  ],
  improvisationRules: [
    "Treat strange, humorous, reckless, ineffective, and low-value actions as valid roleplaying opportunities.",
    "Accept plausible mundane environmental details provisionally when they grant no meaningful advantage and contradict no established fact.",
    "Prefer a completed low-impact or no-effect in-world resolution over a technical rejection.",
    "Use the player's terminal intent to route the action; incidental sources and supporting motions do not replace that intent.",
  ],
  persistenceRules: [
    "Persist identity, possession, relationships, injuries, resources, obligations, and other facts with future causal significance.",
    "Do not create durable entities merely because a noun appears in narration.",
    "Narrative-only details may exist for one resolution, and scene-local details may persist only while relevant to the scene.",
    "Promote a detail into durable state only when future gameplay depends on its identity or consequences.",
    "Persistence and prompt inclusion are separate decisions; retrieve durable facts only when relevant.",
  ],
  authorityRules: [
    "The database and committed event ledger are authoritative for world state and mechanics.",
    "Never use improvisation to create meaningful currency, weapons, ammunition, credentials, keys, vehicles, named people, rare medicine, major resources, or security access.",
    "Do not contradict established player-known facts or use hidden facts in player-facing reasoning.",
    "Do not invent persistent identifiers. Durable references must come from supplied authoritative context.",
    "Specialist models interpret and propose; backend validation and deterministic mechanics commit outcomes.",
  ],
  toneRules: [
    "Respond to absurd actions with grounded, entertaining consequences rather than dismissing the premise.",
    "Keep narration consistent with the committed event and avoid exposing internal implementation details.",
    "Do not moralize about harmless player experimentation.",
  ],
});

export const AI_TASK_CONTEXT_DECLARATIONS = {
  parse_intent: "player_safe_context",
  normalize_content: "constitution_only",
  analyze_consumable: "player_safe_context",
  propose_adjudication: "authoritative_context",
  plan_npc: "authoritative_context",
  summarize_memory: "authoritative_context",
  brainstorm_content: "constitution_only",
  narrate_event: "player_safe_context",
  private_assistant: "player_safe_context",
  resolve_entity_references: "player_safe_context",
  analyze_materialization: "authoritative_context",
  analyze_search_discovery: "authoritative_context",
  plan_persistent_world_action: "player_safe_context",
  simulate_entity_elapsed_time: "authoritative_context",
} satisfies Record<AiTask, AiContextConsumptionMode>;

export function buildGameConstitutionPrompt(
  constitution: GameConstitution = NOCTURNE_GAME_CONSTITUTION,
): string {
  const parsed = GameConstitutionSchema.parse(constitution);
  return [
    `NOCTURNE GAME CONSTITUTION (${parsed.version})`,
    "PURPOSE",
    ...parsed.purpose.map((rule) => `- ${rule}`),
    "IMPROVISATION",
    ...parsed.improvisationRules.map((rule) => `- ${rule}`),
    "PERSISTENCE",
    ...parsed.persistenceRules.map((rule) => `- ${rule}`),
    "AUTHORITY",
    ...parsed.authorityRules.map((rule) => `- ${rule}`),
    "TONE",
    ...parsed.toneRules.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function estimateGameMasterContextTokens(context: Omit<GameMasterContext, "estimatedTokens">) {
  return Math.ceil(JSON.stringify(context).length / 4);
}
