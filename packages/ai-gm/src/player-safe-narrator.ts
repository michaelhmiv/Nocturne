import { z } from "zod";
import type { AiProviderClient, StructuredGenerationResult } from "./ai-provider.js";

export const PLAYER_SAFE_FACT_NARRATION_POLICY_VERSION = "player-safe-facts-v1";

const NarrationSchema = z.object({ narration: z.string().trim().min(1).max(4_000) }).strict();

const narrationJsonSchema = {
  name: "nocturne_player_safe_fact_narration",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["narration"],
    properties: {
      narration: { type: "string" },
    },
  },
} as const;

export type PlayerSafeFactNarrationInput = {
  eventType: string;
  outcomeGrade?: string;
  playerVisibleFacts: string[];
  constraints?: string[];
  style?: "immersive" | "newspaper" | "dialogue" | "concise";
};

export class PlayerSafeFactNarrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerSafeFactNarrationError";
  }
}

function evidenceText(input: PlayerSafeFactNarrationInput) {
  return input.playerVisibleFacts.join(" ").toLowerCase();
}

export function assertPlayerSafeFactNarration(
  narration: string,
  input: PlayerSafeFactNarrationInput,
) {
  const text = narration.toLowerCase();
  const evidence = evidenceText(input);

  const rules = [
    {
      label: "death",
      claim: /\b(?:dead|death|dies?|died|killed|fatal|lifeless)\b/i,
      support: /\b(?:dead|death|dies?|died|killed|fatal|lethal)\b/i,
    },
    {
      label: "injury",
      claim:
        /\b(?:injur(?:y|ed)|bleed(?:ing)?|break|breaks|broke|broken|fractur(?:e|ed)|unconscious|collapse[ds]?)\b/i,
      support:
        /\b(?:injur(?:y|ed)|damage|bleed(?:ing)?|break|breaks|broke|broken|fractur(?:e|ed)|unconscious|collapse[ds]?)\b/i,
    },
    {
      label: "travel or arrival",
      claim:
        /\b(?:arrive[sd]?|reach(?:es|ed)? the|travel(?:s|ed|ing)?|drive(?:s|d|n|ing)? to|walk(?:s|ed|ing)? to)\b/i,
      support: /\b(?:arriv|travel|destination|route|location transition|movement)\b/i,
    },
    {
      label: "ownership or possession",
      claim:
        /\b(?:you now own|becomes yours|you take possession|you acquire|added to your inventory)\b/i,
      support: /\b(?:ownership|possess|acquir|inventory|transfer|purchase|bought|received)\b/i,
    },
    {
      label: "arrest or custody",
      claim: /\b(?:arrested|in custody|taken into custody|detained)\b/i,
      support: /\b(?:arrest|custody|detain)\b/i,
    },
  ];

  for (const rule of rules) {
    if (rule.claim.test(text) && !rule.support.test(evidence)) {
      throw new PlayerSafeFactNarrationError(
        `Narration introduced unsupported ${rule.label} outside player-visible committed facts.`,
      );
    }
  }

  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(narration)) {
    throw new PlayerSafeFactNarrationError("Narration exposed an opaque persistent identifier.");
  }
}

export async function narratePlayerSafeFacts(
  client: Pick<AiProviderClient, "generateStructured">,
  input: PlayerSafeFactNarrationInput,
): Promise<StructuredGenerationResult<{ narration: string }>> {
  const safeInput = {
    eventType: input.eventType,
    outcomeGrade: input.outcomeGrade,
    playerVisibleFacts: input.playerVisibleFacts.slice(0, 32),
    constraints: (input.constraints || []).slice(0, 32),
    style: input.style || "immersive",
  };
  const result = await client.generateStructured({
    task: "narrate_event",
    system: `You are Nocturne's player-facing prose layer. Policy ${PLAYER_SAFE_FACT_NARRATION_POLICY_VERSION}. Write only from supplied player-visible committed facts. Never invent causes, identities, injuries, deaths, movement, ownership, possession, arrests, hidden facts, or state changes. Obey narration constraints. Do not expose database IDs, implementation terms, JSON, or internal enum names.`,
    prompt: JSON.stringify(safeInput),
    jsonSchema: narrationJsonSchema,
    validator: NarrationSchema,
  });
  assertPlayerSafeFactNarration(result.data.narration, input);
  return result;
}
