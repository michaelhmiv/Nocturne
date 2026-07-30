// Compatibility surface for existing imports while the codebase migrates to provider-neutral names.
export {
  AiProviderClient as OpenRouterClient,
  AiProviderError as OpenRouterError,
  isTransientAiProviderError,
  type AiProviderConfig as OpenRouterConfig,
  type AiProviderErrorCode as OpenRouterErrorCode,
  type AiProviderTelemetry,
  type JsonSchemaDefinition,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "./ai-provider.js";
