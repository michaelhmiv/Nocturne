import type { ZodType } from "zod";
import { createModelPolicy, type AiTask } from "./model-policy.js";

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface OpenRouterConfig {
  apiKey: string;
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
}

export interface StructuredGenerationResult<T> {
  data: T;
  requestedModel: string;
  actualModel?: string;
  providerRequestId?: string;
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

  async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({
      task: request.task,
      authoritativeModel: this.config.authoritativeModel,
      creativeModel: this.config.creativeModel,
      requestedModel: request.requestedModel,
    });

    if (!this.config.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    const response = await fetch(`${this.config.baseUrl || "https://openrouter.ai/api/v1"}/chat/completions`, {
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
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 45_000),
    });

    const payload = (await response.json()) as OpenRouterResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenRouter request failed with ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter returned no structured content.");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch (error) {
      throw new Error(`OpenRouter returned invalid JSON: ${String(error)}`);
    }

    const validated = request.validator.safeParse(decoded);
    if (!validated.success) {
      throw new Error(`Structured model output failed validation: ${validated.error.message}`);
    }

    return {
      data: validated.data,
      requestedModel: policy.model,
      actualModel: payload.model,
      providerRequestId: payload.id,
    };
  }
}
