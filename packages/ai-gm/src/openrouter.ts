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
  deepseekApiKey?: string;
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

type JsonObject = Record<string, unknown>;

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

export class OpenRouterClient {
  constructor(private readonly config: OpenRouterConfig) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    retries = 3,
  ): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({
      task: request.task,
      authoritativeModel: this.config.authoritativeModel,
      creativeModel: this.config.creativeModel,
      requestedModel: request.requestedModel,
    });

    const isDeepSeek = Boolean(this.config.deepseekApiKey);
    if (!isDeepSeek && !this.config.apiKey) {
      throw new OpenRouterError("configuration", "OPENROUTER_API_KEY is not configured.");
    }

    const apiKey = isDeepSeek ? this.config.deepseekApiKey! : this.config.apiKey!;
    const baseUrl = isDeepSeek ? "https://api.deepseek.com" : (this.config.baseUrl || "https://openrouter.ai/api/v1");

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs ?? 45_000);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    const body: Record<string, unknown> = {
      model: policy.model,
      temperature: policy.temperature,
      max_tokens: 1024,
      messages: [
        { role: "system", content: request.system },
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
    try {
      response = await fetch(
        `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(!isDeepSeek && this.config.httpReferer ? { "HTTP-Referer": this.config.httpReferer } : {}),
            ...(!isDeepSeek && this.config.appName ? { "X-Title": this.config.appName } : {}),
          },
          body: JSON.stringify(body),
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
      if (retries) return this.generateStructured(request, retries - 1);
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
        { cause: payload.error },
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content || !payload.model) {
      if (retries) return this.generateStructured(request, retries - 1);
      throw new OpenRouterError(
        "malformed_response",
        "OpenRouter returned no structured content or actual model identifier.",
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
      decoded = omitUnexpectedNulls(decoded, request.jsonSchema.schema, request.jsonSchema.schema);
    } catch (error) {
      if (retries) return this.generateStructured(request, retries - 1);
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
      if (retries) return this.generateStructured(request, retries - 1);
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
