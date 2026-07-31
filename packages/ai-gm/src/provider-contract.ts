import { z } from "zod";
import { createAiProviderClientFromEnv, resolveAiProviderConfigFromEnv } from "./index.js";

const ContractSchema = z
  .object({
    status: z.literal("ok"),
    capability: z.string().min(1),
  })
  .strict();

const jsonSchema = {
  name: "nocturne_provider_contract",
  description: "Minimal structured-output compatibility probe for the configured provider.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "capability"],
    properties: {
      status: { const: "ok" },
      capability: { type: "string", minLength: 1 },
    },
  },
} as const;

const configuration = resolveAiProviderConfigFromEnv(process.env);
if (!configuration.apiKey) {
  throw new Error(
    `No API key is configured for provider contract testing (${configuration.provider}).`,
  );
}

const client = createAiProviderClientFromEnv(process.env);
const startedAt = Date.now();
const authoritative = await client.generateStructured({
  task: "parse_intent",
  system: "You are a provider compatibility probe. Return the requested exact status object.",
  prompt: 'Return {"status":"ok","capability":"authoritative-json"}.',
  jsonSchema,
  validator: ContractSchema,
});
const creative = await client.generateStructured({
  task: "narrate_event",
  system: "You are a provider compatibility probe. Return the requested exact status object.",
  prompt: 'Return {"status":"ok","capability":"creative-json"}.',
  jsonSchema,
  validator: ContractSchema,
});

console.log(
  JSON.stringify(
    {
      status: "passed",
      provider: configuration.provider,
      configuredModel: configuration.model,
      authoritativeModel: authoritative.actualModel,
      creativeModel: creative.actualModel,
      authoritativeRequestId: authoritative.providerRequestId || null,
      creativeRequestId: creative.providerRequestId || null,
      durationMs: Date.now() - startedAt,
    },
    null,
    2,
  ),
);
