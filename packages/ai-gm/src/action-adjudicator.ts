import { z } from "zod";
import {
  ParsedActionEnvelopeSchema,
  type ActionExecutionResponse,
  type ParsedActionEnvelope,
  type SubmitActionRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const ACTION_PARSE_POLICY_VERSION = "action-parse-v3";
export const EVENT_NARRATION_POLICY_VERSION = "event-narration-v2";

const actionSchema = {
  name: "nocturne_action_intent",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["intent", "proposedModifiers", "relevantContextFacts"],
    properties: {
      intent: {
        type: "object",
        additionalProperties: false,
        required: [
          "actorId",
          "rawText",
          "actionType",
          "targetIds",
          "methodDefinitionIds",
          "objective",
          "intensity",
          "assumptions",
          "confidence",
        ],
        properties: {
          actorId: { type: "string" },
          rawText: { type: "string" },
          actionType: { type: "string" },
          targetIds: { type: "array", items: { type: "string" } },
          methodDefinitionIds: { type: "array", items: { type: "string" } },
          objective: { type: "string" },
          intensity: { enum: ["careful", "normal", "urgent", "maximum"] },
          assumptions: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      proposedModifiers: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["factorId", "value", "reason", "citedContextFact"],
          properties: {
            factorId: { type: "string" },
            value: { type: "integer", minimum: -2, maximum: 2 },
            reason: { type: "string" },
            sourceId: { type: "string" },
            citedContextFact: { type: "string" },
          },
        },
      },
      relevantContextFacts: { type: "array", maxItems: 12, items: { type: "string" } },
    },
  },
} as const;

export async function parseActionWithAi(
  client: AiProviderClient,
  input: SubmitActionRequest,
  publicContext: Record<string, unknown>,
): Promise<StructuredGenerationResult<ParsedActionEnvelope>> {
  return client.generateStructured({
    task: "parse_intent",
    system: `You are Nocturne's authoritative intent parser. Policy ${ACTION_PARSE_POLICY_VERSION}. Use only supplied viewpoint facts. Never invent capabilities, possessions, available objects, or hidden targets. Eating, drinking, swallowing, ingesting, tasting, or otherwise taking a substance into the body is a consume action. It is not automatically a heal action. The authoritative consumption resolver will determine whether the referenced thing exists, is accessible, is consumable, and what effects it has. Do not place opaque database identifiers in the objective or assumptions.`,
    prompt: `PLAYER ACTION:\n${input.rawText}\n\nPUBLIC CONTEXT:\n${JSON.stringify(publicContext)}`,
    jsonSchema: actionSchema,
    validator: ParsedActionEnvelopeSchema,
  });
}

export function deterministicActionFallback(
  input: SubmitActionRequest,
  methodDefinitionId: string,
  targetLocationId: string,
): ParsedActionEnvelope {
  const text = input.rawText.toLowerCase();
  // ponytail: keyword map for offline/dev. Word boundaries; crime before location nouns.
  const actionType = /\b(steal|pickpocket|theft)\b/.test(text)
    ? "steal"
    : /\b(attack|punch|fight|hit)\b/.test(text)
      ? "attack"
      : /\b(hack|security panel|disable camera)\b/.test(text)
        ? "hack"
        : /\b(message|text|call|radio|ping)\b/.test(text)
          ? "talk"
          : /\b(talk|chat|conversation|ask)\b/.test(text)
            ? "talk"
            : /\b(sneak|silently|stealth)\b/.test(text)
              ? "sneak"
              : /\b(eat|drink|consume|swallow|ingest|taste|food|meal|cake|snack)\b/.test(text)
                ? "consume"
                : /\b(heal|bandage|first aid|medkit)\b/.test(text)
                  ? "heal"
                  : /\b(drive|vehicle|bike|car)\b/.test(text)
                    ? "drive"
                    : /\b(move|walk|go to|travel)\b/.test(text)
                      ? "move"
                      : /\b(search|look through|scan|look around)\b/.test(text)
                        ? "search"
                        : /\b(work|gig|shift|job|courier run)\b/.test(text)
                          ? "work"
                          : /\b(look|detect|cameras?)\b/.test(text)
                            ? "detect"
                            : "detect";

  return {
    intent: {
      actorId: input.actorId,
      rawText: input.rawText,
      actionType,
      targetIds: [targetLocationId],
      methodDefinitionIds: methodDefinitionId ? [methodDefinitionId] : [],
      objective: input.rawText.slice(0, 120),
      intensity: /careful|quiet|slowly/i.test(input.rawText) ? "careful" : "normal",
      assumptions: [],
      confidence: 0.9,
    },
    proposedModifiers: [],
    relevantContextFacts: [
      "The rear alley is directly adjacent to the residence.",
      "The rear alley has dim lighting and moderate clutter.",
    ],
  };
}

const NarrationEnvelopeSchema = z.object({ narration: z.string().min(1).max(4_000) });
const narrationSchema = {
  name: "nocturne_event_narration",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["narration"],
    properties: { narration: { type: "string" } },
  },
} as const;

export async function narrateCommittedEvent(
  client: AiProviderClient,
  input: Omit<ActionExecutionResponse, "narration" | "idempotentReplay"> & {
    factsToPreserve: string[];
    hiddenFactsToExclude: string[];
  },
): Promise<StructuredGenerationResult<{ narration: string }>> {
  return client.generateStructured({
    task: "narrate_event",
    system: `Narrate only the committed Nocturne event. Policy ${EVENT_NARRATION_POLICY_VERSION}. Preserve every supplied fact and never reveal excluded facts. Write immersive player-facing prose. Never mention actor IDs, target IDs, database IDs, enum names, raw intent structures, calculation traces, JSON, truncation, or internal implementation terms. Refer to the player as "you" and use supplied human-readable names when available.`,
    prompt: JSON.stringify(input),
    jsonSchema: narrationSchema,
    validator: NarrationEnvelopeSchema,
  });
}

export function deterministicNarrationFallback(outcome: string): string {
  const narration: Record<string, string> = {
    complete_success:
      "The action lands cleanly and produces the intended result without an obvious complication.",
    success_with_consequence:
      "You get what you were after, though the result carries a consequence you cannot ignore.",
    partial_success:
      "The attempt works well enough to move things forward, but the result is incomplete.",
    failure_with_progress:
      "The attempt falls short, though it reveals enough to leave you with a way forward.",
    failure: "The attempt does not produce the result you intended.",
    catastrophic_reversal: "The attempt goes badly and leaves you with a new problem.",
  };
  return narration[outcome] || "The action resolves, but the result is difficult to read.";
}
