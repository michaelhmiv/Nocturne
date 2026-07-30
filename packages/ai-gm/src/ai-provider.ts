import type { ZodType } from "zod";
import { createModelPolicy, type AiTask, type ModelPolicy } from "./model-policy.js";

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface AiProviderTelemetry {
  task: AiTask;
  provider: "deepseek" | "openrouter";
  model: string;
  attempt: number;
  latencyMs: number;
  status: "success" | "error";
  errorCode?: AiProviderErrorCode;
}

export interface AiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  authoritativeModel?: string;
  creativeModel?: string;
  fallbackModel?: string;
  httpReferer?: string;
  appName?: string;
  timeoutMs?: number;
  deepseekApiKey?: string;
  logger?: (entry: AiProviderTelemetry) => void;
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
  provider: "deepseek" | "openrouter";
  providerRequestId?: string;
  attempts: number;
  latencyMs: number;
}

export type AiProviderErrorCode =
  | "configuration"
  | "aborted"
  | "timeout"
  | "rate_limited"
  | "provider_rejected"
  | "provider_failure"
  | "malformed_response"
  | "validation";

export class AiProviderError extends Error {
  cause?: unknown;

  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "AiProviderError";
    if (options && "cause" in options) this.cause = options.cause;
  }
}

export function isTransientAiProviderError(error: unknown): error is AiProviderError {
  return (
    error instanceof AiProviderError &&
    ["timeout", "rate_limited", "provider_failure", "malformed_response", "validation"].includes(
      error.code,
    )
  );
}

interface ProviderResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

type JsonObject = Record<string, unknown>;
type ProviderName = "deepseek" | "openrouter";

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveSchema(schema: unknown, root: JsonObject): JsonObject | undefined {
  if (!object(schema)) return undefined;
  const reference = schema.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/")) return schema;
  const resolved = reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((value, part) => (object(value) ? value[part] : undefined), root);
  return object(resolved) ? resolved : schema;
}

function allowsNull(schema: unknown, root: JsonObject): boolean {
  const resolved = resolveSchema(schema, root);
  if (!resolved) return false;
  if (resolved.type === "null") return true;
  if (Array.isArray(resolved.type) && resolved.type.includes("null")) return true;
  return [resolved.anyOf, resolved.oneOf].some(
    (variants) => Array.isArray(variants) && variants.some((variant) => allowsNull(variant, root)),
  );
}

function omitUnexpectedNulls(value: unknown, schema: unknown, root: JsonObject): unknown {
  const resolved = resolveSchema(schema, root);
  if (!resolved) return value;
  if (Array.isArray(value))
    return value.map((item) => omitUnexpectedNulls(item, resolved.items, root));
  if (!object(value)) return value;
  const variants = Array.isArray(resolved.anyOf)
    ? resolved.anyOf
    : Array.isArray(resolved.oneOf)
      ? resolved.oneOf
      : [];
  if (variants.length)
    return omitUnexpectedNulls(
      value,
      variants.find((variant) => !allowsNull(variant, root)),
      root,
    );
  if (!object(resolved.properties)) return value;
  const cleaned: JsonObject = { ...value };
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
  for (const [key, propertySchema] of Object.entries(resolved.properties)) {
    const property = resolveSchema(propertySchema, root);
    if (!(key in cleaned)) {
      if (required.has(key) && property?.type === "array") cleaned[key] = [];
      continue;
    }
    if (cleaned[key] === null && !allowsNull(propertySchema, root)) {
      if (required.has(key) && property?.type === "array") cleaned[key] = [];
      else if (!required.has(key)) delete cleaned[key];
    } else cleaned[key] = omitUnexpectedNulls(cleaned[key], propertySchema, root);
  }
  return cleaned;
}

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

export class AiProviderClient {
  constructor(private readonly config: AiProviderConfig) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    retries = 2,
  ): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({
      task: request.task,
      authoritativeModel: this.config.authoritativeModel,
      creativeModel: this.config.creativeModel,
      requestedModel: request.requestedModel,
    });
    const primary: ProviderName = this.config.deepseekApiKey ? "deepseek" : "openrouter";
    const primaryModel =
      primary === "deepseek" ? policy.model : this.config.fallbackModel || policy.model;

    try {
      return await this.generateWithProvider(request, policy, primary, primaryModel, retries);
    } catch (error) {
      const canFallback =
        primary === "deepseek" &&
        Boolean(this.config.apiKey) &&
        Boolean(this.config.fallbackModel) &&
        isTransientAiProviderError(error);
      if (!canFallback) throw error;
      return this.generateWithProvider(
        request,
        policy,
        "openrouter",
        this.config.fallbackModel!,
        retries,
      );
    }
  }

  private async generateWithProvider<T>(
    request: StructuredGenerationRequest<T>,
    policy: ModelPolicy,
    provider: ProviderName,
    model: string,
    retries: number,
  ): Promise<StructuredGenerationResult<T>> {
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const result = await this.callProvider(request, policy, provider, model);
        this.config.logger?.({
          task: request.task,
          provider,
          model,
          attempt,
          latencyMs: Date.now() - attemptStartedAt,
          status: "success",
        });
        return {
          ...result,
          provider,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const code = error instanceof AiProviderError ? error.code : "provider_failure";
        this.config.logger?.({
          task: request.task,
          provider,
          model,
          attempt,
          latencyMs: Date.now() - attemptStartedAt,
          status: "error",
          errorCode: code,
        });
        if (!isTransientAiProviderError(error) || attempt > retries) throw error;
      }
    }

    throw lastError;
  }

  private async callProvider<T>(
    request: StructuredGenerationRequest<T>,
    policy: ModelPolicy,
    provider: ProviderName,
    model: string,
  ): Promise<Omit<StructuredGenerationResult<T>, "provider" | "attempts" | "latencyMs">> {
    const isDeepSeek = provider === "deepseek";
    const apiKey = isDeepSeek ? this.config.deepseekApiKey : this.config.apiKey;
    if (!apiKey) {
      throw new AiProviderError(
        "configuration",
        `${isDeepSeek ? "DEEPSEEK_API_KEY" : "OPENROUTER_API_KEY"} is not configured.`,
      );
    }

    const baseUrl = isDeepSeek
      ? "https://api.deepseek.com"
      : this.config.baseUrl || "https://openrouter.ai/api/v1";
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs ?? 45_000);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;
    const body: Record<string, unknown> = {
      model,
      temperature: policy.temperature,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: isDeepSeek
            ? `${request.system}\nReturn exactly one valid JSON object. Do not use Markdown or explanatory text.`
            : request.system,
        },
        { role: "user", content: request.prompt },
      ],
      response_format: isDeepSeek
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: {
              name: request.jsonSchema.name,
              description: request.jsonSchema.description,
              strict: false,
              schema: request.jsonSchema.schema,
            },
          },
    };
    if (!isDeepSeek) {
      body.plugins = [{ id: "response-healing" }];
      body.provider = { require_parameters: true };
    }

    let response: Response;
    try {
      response = await fetch(completionEndpoint(baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(!isDeepSeek && this.config.httpReferer
            ? { "HTTP-Referer": this.config.httpReferer }
            : {}),
          ...(!isDeepSeek && this.config.appName ? { "X-Title": this.config.appName } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AiProviderError("aborted", "AI provider request was aborted.", { cause: error });
      }
      if (timeoutSignal.aborted) {
        throw new AiProviderError("timeout", "AI provider request timed out.", { cause: error });
      }
      throw new AiProviderError("provider_failure", "AI provider request failed.", {
        cause: error,
      });
    }

    let payload: ProviderResponse;
    try {
      payload = JSON.parse(await response.text()) as ProviderResponse;
    } catch (error) {
      throw new AiProviderError("malformed_response", "AI provider returned malformed JSON.", {
        cause: error,
      });
    }

    if (!response.ok) {
      const code: AiProviderErrorCode =
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_failure"
            : "provider_rejected";
      throw new AiProviderError(
        code,
        payload.error?.message || `AI provider request failed with ${response.status}.`,
        { cause: payload.error },
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content || !payload.model) {
      throw new AiProviderError(
        "malformed_response",
        "AI provider returned no structured content or actual model identifier.",
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
      decoded = omitUnexpectedNulls(decoded, request.jsonSchema.schema, request.jsonSchema.schema);
    } catch (error) {
      throw new AiProviderError(
        "malformed_response",
        "AI provider returned invalid structured JSON.",
        { cause: error },
      );
    }

    const validated = request.validator.safeParse(decoded);
    if (!validated.success) {
      throw new AiProviderError(
        "validation",
        `Structured model output failed validation: ${validated.error.message}`,
      );
    }

    return {
      data: validated.data,
      requestedModel: model,
      actualModel: payload.model,
      providerRequestId: payload.id,
    };
  }
}
