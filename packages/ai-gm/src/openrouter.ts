import {
  AiProviderClient,
  AiProviderError,
  isTransientAiProviderError,
  type AiProviderConfig,
  type AiProviderErrorCode,
  type AiProviderTelemetry,
  type JsonSchemaDefinition,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "./ai-provider.js";

/**
 * Compatibility client used by Nocturne's structured AI workflows.
 *
 * A schema-invalid response is generally deterministic for the same model and
 * prompt. Retrying it several times delays the worker long enough to exhaust
 * the outer job attempts. Default to one provider attempt, allowing the base
 * client to fail over immediately when an OpenRouter fallback is configured.
 */
export class OpenRouterClient extends AiProviderClient {
  override generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    retries = 0,
  ): Promise<StructuredGenerationResult<T>> {
    return super.generateStructured(request, retries);
  }
}

export {
  AiProviderError as OpenRouterError,
  isTransientAiProviderError,
};
export type {
  AiProviderConfig as OpenRouterConfig,
  AiProviderErrorCode as OpenRouterErrorCode,
  AiProviderTelemetry,
  JsonSchemaDefinition,
  StructuredGenerationRequest,
  StructuredGenerationResult,
};
