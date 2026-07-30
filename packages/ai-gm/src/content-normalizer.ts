import {
  NormalizedContentEnvelopeSchema,
  type NormalizeContentRequest,
  type NormalizedContentEnvelope,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const CONTENT_NORMALIZATION_POLICY_VERSION = "content-normalization-v1";

const normalizedContentJsonSchema = {
  name: "nocturne_generated_content",
  description: "A player concept normalized into Nocturne's universal content model.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["draft", "rationale", "assumptions", "provisionalComponents"],
    properties: {
      draft: {
        type: "object",
        additionalProperties: false,
        required: [
          "definitionType",
          "conceptSummary",
          "traits",
          "effects",
          "modes",
          "requirements",
          "costs",
          "limitations",
          "risks",
          "signatures",
          "counters",
          "relationships",
          "acquisitionPath",
          "extensionPayload",
          "status",
        ],
        properties: {
          definitionType: { type: "string" },
          name: { type: "string" },
          conceptSummary: { type: "string" },
          playerFantasy: { type: "string" },
          noveltyLevel: { type: "integer", minimum: 0, maximum: 5 },
          originSource: { type: "string" },
          traits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "type", "parameters"],
              properties: {
                name: { type: "string" },
                type: {
                  enum: [
                    "descriptive",
                    "mechanical",
                    "source",
                    "material",
                    "behavior",
                    "legal",
                    "aesthetic",
                  ],
                },
                parameters: { type: "object", additionalProperties: true },
              },
            },
          },
          effects: { type: "array", items: { $ref: "#/properties/draft/$defs/effect" } },
          modes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["modeId", "name", "effects", "requirements", "costs", "signatures"],
              properties: {
                modeId: { type: "string" },
                name: { type: "string" },
                effects: { type: "array", items: { $ref: "#/properties/draft/$defs/effect" } },
                requirements: {
                  type: "array",
                  items: { $ref: "#/properties/draft/$defs/requirement" },
                },
                costs: { type: "array", items: { $ref: "#/properties/draft/$defs/cost" } },
                signatures: {
                  type: "array",
                  items: { $ref: "#/properties/draft/$defs/signature" },
                },
              },
            },
          },
          requirements: { type: "array", items: { $ref: "#/properties/draft/$defs/requirement" } },
          costs: { type: "array", items: { $ref: "#/properties/draft/$defs/cost" } },
          limitations: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          signatures: { type: "array", items: { $ref: "#/properties/draft/$defs/signature" } },
          counters: { type: "array", items: { type: "string" } },
          relationships: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["relationType", "parameters"],
              properties: {
                relationType: { type: "string" },
                targetDefinitionId: { type: "string" },
                targetInstanceId: { type: "string" },
                parameters: { type: "object", additionalProperties: true },
              },
              anyOf: [{ required: ["targetDefinitionId"] }, { required: ["targetInstanceId"] }],
            },
          },
          acquisitionPath: {
            type: "object",
            additionalProperties: false,
            required: ["type", "parameters"],
            properties: {
              type: {
                enum: [
                  "immediate",
                  "purchased",
                  "trained",
                  "built",
                  "researched",
                  "discovered",
                  "inherited",
                  "story_gated",
                ],
              },
              stages: { type: "integer", minimum: 1 },
              parameters: { type: "object", additionalProperties: true },
            },
          },
          extensionPayload: { type: "object", additionalProperties: true },
          status: { enum: ["draft", "provisional", "approved", "deprecated", "restricted"] },
        },
        $defs: {
          effect: {
            type: "object",
            additionalProperties: false,
            required: ["effectId", "target", "strength", "parameters"],
            properties: {
              effectId: { type: "string" },
              domainId: { type: "string" },
              modeId: { type: "string" },
              target: { type: "string" },
              strength: { type: "integer", minimum: 0, maximum: 10 },
              range: { type: "string" },
              scale: { type: "string" },
              precision: { type: "integer", minimum: 0, maximum: 10 },
              duration: { type: "string" },
              parameters: { type: "object", additionalProperties: true },
            },
          },
          requirement: {
            type: "object",
            additionalProperties: false,
            required: ["phase", "ruleId", "parameters", "severity"],
            properties: {
              phase: { enum: ["creation", "installation", "activation", "targeting", "upkeep"] },
              ruleId: { type: "string" },
              parameters: { type: "object", additionalProperties: true },
              severity: { enum: ["hard", "conditional", "warning"] },
            },
          },
          cost: {
            type: "object",
            additionalProperties: false,
            required: ["resource", "amount", "timing", "parameters"],
            properties: {
              resource: { type: "string" },
              amount: { type: "number", minimum: 0 },
              timing: { enum: ["creation", "installation", "activation", "per_tick", "upkeep"] },
              parameters: { type: "object", additionalProperties: true },
            },
          },
          signature: {
            type: "object",
            additionalProperties: false,
            required: ["channel", "strength", "parameters"],
            properties: {
              channel: { type: "string" },
              strength: { type: "integer", minimum: 0, maximum: 10 },
              persistence: { type: "string" },
              parameters: { type: "object", additionalProperties: true },
            },
          },
        },
      },
      rationale: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      provisionalComponents: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export function buildContentNormalizationPrompt(input: NormalizeContentRequest): string {
  return `Normalize the following player invention into the Nocturne universal content model. Preserve the fantasy while making requirements, costs, limitations, risks, signatures, and counters causally meaningful. Prefer existing general effect verbs. Do not make the concept stronger merely because it sounds impressive. Installation capacity rules must use capacity.space, capacity.power, capacity.concealment, capacity.security, or capacity.access with a numeric minimum.\n\nPLAYER CONCEPT:\n${input.rawConcept}\n\nINTENDED USE:\n${input.intendedUse || "Not separately specified."}`;
}

export async function normalizeGeneratedContent(
  client: AiProviderClient,
  input: NormalizeContentRequest,
): Promise<StructuredGenerationResult<NormalizedContentEnvelope>> {
  return client.generateStructured({
    task: "normalize_content",
    system: `You are Nocturne's authoritative content normalizer. Policy version: ${CONTENT_NORMALIZATION_POLICY_VERSION}. Output only the required structured object.`,
    prompt: buildContentNormalizationPrompt(input),
    jsonSchema: normalizedContentJsonSchema,
    validator: NormalizedContentEnvelopeSchema,
  });
}

export function deterministicSurveillanceFallback(
  input: NormalizeContentRequest,
): NormalizedContentEnvelope {
  const nameMatch = /(?:called|named)\s+["']?([^"'.]{3,60})/i.exec(input.rawConcept);
  return {
    draft: {
      definitionType: "installed_sensor_system",
      name: nameMatch?.[1]?.trim() || "Custom Surveillance Array",
      conceptSummary: input.rawConcept.slice(0, 500),
      playerFantasy: input.rawConcept,
      noveltyLevel: 2,
      originSource: "technology",
      traits: [{ name: "custom-built", type: "mechanical", parameters: {} }],
      effects: [],
      modes: [
        {
          modeId: "local_scan",
          name: "Local Scan",
          effects: [
            {
              effectId: "sense",
              domainId: "information",
              target: "movement and heat signatures",
              strength: 4,
              range: "adjacent location",
              precision: 3,
              parameters: { channels: ["thermal", "acoustic", "visual"] },
            },
            {
              effectId: "analyze",
              domainId: "information",
              target: "detected activity",
              strength: 3,
              parameters: { output: "contact classification and confidence" },
            },
          ],
          requirements: [
            {
              phase: "installation",
              ruleId: "capacity.space",
              parameters: { minimum: 2 },
              severity: "hard",
            },
            {
              phase: "installation",
              ruleId: "capacity.power",
              parameters: { minimum: 2 },
              severity: "hard",
            },
            {
              phase: "installation",
              ruleId: "capacity.concealment",
              parameters: { minimum: 1 },
              severity: "conditional",
            },
          ],
          costs: [{ resource: "power", amount: 1, timing: "activation", parameters: {} }],
          signatures: [
            {
              channel: "electromagnetic",
              strength: 2,
              persistence: "while active",
              parameters: {},
            },
          ],
        },
      ],
      requirements: [
        {
          phase: "creation",
          ruleId: "skill.electronics",
          parameters: { minimum: 2 },
          severity: "conditional",
        },
      ],
      costs: [
        { resource: "money", amount: 2500, timing: "creation", parameters: { currency: "USD" } },
      ],
      limitations: [
        "Coverage is limited to the installed building and immediately adjacent spaces.",
        "Identification requires a known signature or corroborating evidence.",
      ],
      risks: [
        "The system can generate false positives in crowded conditions.",
        "Active electronics can be discovered or compromised.",
      ],
      signatures: [],
      counters: ["Thermal masking", "Acoustic damping", "Power interruption", "Sensor spoofing"],
      relationships: [],
      acquisitionPath: { type: "built", stages: 2, parameters: {} },
      extensionPayload: { installationRequirements: { space: 2, power: 2, concealment: 1 } },
      status: "provisional",
    },
    rationale: [
      "Converted the concept into channel-specific sensing and analysis effects.",
      "Added apartment-scale requirements and discoverable counterplay.",
    ],
    assumptions: [
      "The device is intended for the player's residence rather than citywide monitoring.",
    ],
    provisionalComponents: [],
  };
}
