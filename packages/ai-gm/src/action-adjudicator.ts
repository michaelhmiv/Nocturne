import { z } from "zod";
import {
  ParsedActionEnvelopeSchema,
  type ActionExecutionResponse,
  type ParsedActionEnvelope,
  type SubmitActionRequest,
} from "@nocturne/contracts";
import { OpenRouterClient, type StructuredGenerationResult } from "./openrouter.js";

export const ACTION_PARSE_POLICY_VERSION = "action-parse-v1";
export const EVENT_NARRATION_POLICY_VERSION = "event-narration-v1";

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
  client: OpenRouterClient,
  input: SubmitActionRequest,
  publicContext: Record<string, unknown>,
): Promise<StructuredGenerationResult<ParsedActionEnvelope>> {
  return client.generateStructured({
    task: "parse_intent",
    system: `You are Nocturne's authoritative intent parser. Policy ${ACTION_PARSE_POLICY_VERSION}. Use only supplied viewpoint facts. Never invent capabilities or hidden targets.`,
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
  return {
    intent: {
      actorId: input.actorId,
      rawText: input.rawText,
      actionType: "detect",
      targetIds: [targetLocationId],
      methodDefinitionIds: [methodDefinitionId],
      objective: "Detect and classify suspicious movement in the rear alley.",
      intensity: /careful|quiet/i.test(input.rawText) ? "careful" : "normal",
      assumptions: ["Use the installed system's ordinary local-scan mode."],
      confidence: 0.95,
    },
    proposedModifiers: [],
    relevantContextFacts: [
      "The selected system is installed in the actor's residence.",
      "The rear alley is adjacent to the residence.",
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
  client: OpenRouterClient,
  input: Omit<ActionExecutionResponse, "narration" | "idempotentReplay"> & {
    factsToPreserve: string[];
    hiddenFactsToExclude: string[];
  },
): Promise<StructuredGenerationResult<{ narration: string }>> {
  return client.generateStructured({
    task: "narrate_event",
    system: `Narrate only the committed Nocturne event. Policy ${EVENT_NARRATION_POLICY_VERSION}. Preserve every supplied fact and never reveal excluded facts.`,
    prompt: JSON.stringify(input),
    jsonSchema: narrationSchema,
    validator: NarrationEnvelopeSchema,
  });
}

export function deterministicNarrationFallback(outcome: string): string {
  const narration: Record<string, string> = {
    complete_success:
      "The array settles into a clean rhythm. A human-sized contact resolves in the rear alley, moving with enough consistency for a reliable track.",
    success_with_consequence:
      "The alley resolves into a steady contact, but the scan runs hot enough that anyone watching the spectrum may notice the system at work.",
    partial_success:
      "Several channels converge on movement in the alley. The presence is credible, though its exact position and identity remain uncertain.",
    failure_with_progress:
      "The display catches a brief, inconsistent anomaly from the alley—too weak for a track, but too coherent to dismiss outright.",
    failure:
      "The scan completes without a reliable contact. The alley remains unresolved rather than proven empty.",
    catastrophic_reversal:
      "The scan collapses into noise and the array reports a fault. Whatever is outside remains hidden while the system absorbs the mistake.",
  };
  return (
    narration[outcome] || "The action resolves, but the system cannot produce a fuller account."
  );
}
