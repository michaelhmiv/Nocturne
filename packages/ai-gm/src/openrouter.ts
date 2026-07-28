import type { ZodType } from "zod";
import { createModelPolicy, type AiTask } from "./model-policy.js";

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface OpenRouterConfig {
  apiKey?: string;
  baseUrl?: string;
  authoritativeModel?: string;
  creativeModel?: string;
  httpReferer?: string;
  appName?: string;
  timeoutMs?: number;
}

export interface StructuredGenerationRequest<T> {
  task: AiTask;
  system: string;
  prompt: string;
  jsonSchema: JsonSchemaDefinition;
  validator: ZodType<T>;
  requestedModel?: string;
  signal?: AbortSignal;
}

export interface StructuredGenerationResult<T> {
  data: T;
  requestedModel: string;
  actualModel: string;
  providerRequestId?: string;
}

export type OpenRouterErrorCode =
  | "configuration"
  | "aborted"
  | "timeout"
  | "rate_limited"
  | "provider_rejected"
  | "provider_failure"
  | "malformed_response"
  | "validation";

export class OpenRouterError extends Error {
  cause?: unknown;

  constructor(
    readonly code: OpenRouterErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "OpenRouterError";
    if (options && "cause" in options) this.cause = options.cause;
  }
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenRouterClient {
  constructor(private readonly config: OpenRouterConfig) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({
      task: request.task,
      authoritativeModel: this.config.authoritativeModel,
      creativeModel: this.config.creativeModel,
      requestedModel: request.requestedModel,
    });

    if (!this.config.apiKey) {
      throw new OpenRouterError("configuration", "OPENROUTER_API_KEY is not configured.");
    }

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs ?? 45_000);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(
        `${this.config.baseUrl || "https://openrouter.ai/api/v1"}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            ...(this.config.httpReferer ? { "HTTP-Referer": this.config.httpReferer } : {}),
            ...(this.config.appName ? { "X-Title": this.config.appName } : {}),
          },
          body: JSON.stringify({
            model: policy.model,
            temperature: policy.temperature,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.jsonSchema.name,
                description: request.jsonSchema.description,
                strict: true,
                schema: request.jsonSchema.schema,
              },
            },
            provider: {
              require_parameters: true,
            },
          }),
          signal,
        },
      );
    } catch (error) {
      if (request.signal?.aborted) {
        throw new OpenRouterError("aborted", "OpenRouter request was aborted.", { cause: error });
      }
      if (timeoutSignal.aborted) {
        throw new OpenRouterError("timeout", "OpenRouter request timed out.", { cause: error });
      }
      throw new OpenRouterError("provider_failure", "OpenRouter request failed.", { cause: error });
    }

    let payload: OpenRouterResponse;
    try {
      payload = JSON.parse(await response.text()) as OpenRouterResponse;
    } catch (error) {
      throw new OpenRouterError("malformed_response", "OpenRouter returned malformed JSON.", {
        cause: error,
      });
    }

    if (!response.ok) {
      const code =
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_failure"
            : "provider_rejected";
      throw new OpenRouterError(
        code,
        payload.error?.message || `OpenRouter request failed with ${response.status}.`,
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content || !payload.model) {
      throw new OpenRouterError(
        "malformed_response",
        "OpenRouter returned no structured content or actual model identifier.",
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch (error) {
      throw new OpenRouterError(
        "malformed_response",
        "OpenRouter returned invalid structured JSON.",
        {
          cause: error,
        },
      );
    }

    const validated = request.validator.safeParse(decoded);
    if (!validated.success) {
      throw new OpenRouterError(
        "validation",
        `Structured model output failed validation: ${validated.error.message}`,
      );
    }

    return {
      data: validated.data,
      requestedModel: policy.model,
      actualModel: payload.model,
      providerRequestId: payload.id,
    };
  }
}
