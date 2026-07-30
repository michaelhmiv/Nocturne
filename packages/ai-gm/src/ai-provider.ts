import type { ZodType } from "zod";
import {
  DEEPSEEK_FLASH_MODEL,
  createModelPolicy,
  type AiTask,
} from "./model-policy.js";

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface AiProviderTelemetry {
  task: AiTask;
  provider: "deepseek";
  model: typeof DEEPSEEK_FLASH_MODEL;
  attempt: number;
  latencyMs: number;
  status: "success" | "error";
  errorCode?: AiProviderErrorCode;
}

export interface AiProviderConfig {
  deepseekApiKey?: string;
  timeoutMs?: number;
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
  requestedModel: typeof DEEPSEEK_FLASH_MODEL;
  actualModel: string;
  provider: "deepseek";
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
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  error?: { message?: string; type?: string; code?: string | number };
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
    (variants) =>
      Array.isArray(variants) && variants.some((variant) => allowsNull(variant, root)),
  );
}

function omitUnexpectedNulls(value: unknown, schema: unknown, root: JsonObject): unknown {
  const resolved = resolveSchema(schema, root);
  if (!resolved) return value;
  if (Array.isArray(value)) {
    return value.map((item) => omitUnexpectedNulls(item, resolved.items, root));
  }
  if (!object(value)) return value;
  const variants = Array.isArray(resolved.anyOf)
    ? resolved.anyOf
    : Array.isArray(resolved.oneOf)
      ? resolved.oneOf
      : [];
  if (variants.length) {
    return omitUnexpectedNulls(
      value,
      variants.find((variant) => !allowsNull(variant, root)),
      root,
    );
  }
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
    } else {
      cleaned[key] = omitUnexpectedNulls(cleaned[key], propertySchema, root);
    }
  }
  return cleaned;
}

function exampleFromSchema(schema: unknown, root: JsonObject, depth = 0): unknown {
  if (depth > 8) return null;
  const resolved = resolveSchema(schema, root);
  if (!resolved) return null;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];
  const variants = Array.isArray(resolved.anyOf)
    ? resolved.anyOf
    : Array.isArray(resolved.oneOf)
      ? resolved.oneOf
      : [];
  if (variants.length) {
    const nonNull = variants.find((variant) => !allowsNull(variant, root));
    return exampleFromSchema(nonNull ?? variants[0], root, depth + 1);
  }
  const type = Array.isArray(resolved.type)
    ? resolved.type.find((value) => value !== "null")
    : resolved.type;
  if (type === "object" || object(resolved.properties)) {
    const properties = object(resolved.properties) ? resolved.properties : {};
    const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
    return Object.fromEntries(
      Object.entries(properties)
        .filter(([key]) => required.has(key))
        .map(([key, value]) => [key, exampleFromSchema(value, root, depth + 1)]),
    );
  }
  if (type === "array") return [];
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return "<string>";
}

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export class AiProviderClient {
  constructor(private readonly config: AiProviderConfig) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    retries = 1,
  ): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({ task: request.task });
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const result = await this.callDeepSeek(request, policy.temperature);
        this.config.logger?.({
task: request.task,
provider: "deepseek",
model: DEEPSEEK_FLASH_MODEL,
attempt,
latencyMs: Date.now() - attemptStartedAt,
status: "success",
        });
        return {
...result,
provider: "deepseek",
attempts: attempt,
latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const code = error instanceof AiProviderError ? error.code : "provider_failure";
        this.config.logger?.({
task: request.task,
provider: "deepseek",
model: DEEPSEEK_FLASH_MODEL,
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

  private async callDeepSeek<T>(
    request: StructuredGenerationRequest<T>,
    temperature: number,
  ): Promise<Omit<StructuredGenerationResult<T>, "provider" | "attempts" | "latencyMs">> {
    const apiKey = this.config.deepseekApiKey;
    if (!apiKey) {
      throw new AiProviderError("configuration", "DEEPSEEK_API_KEY is not configured.");
    }

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs ?? 60_000);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;
    const example = exampleFromSchema(request.jsonSchema.schema, request.jsonSchema.schema);
    const system = [
      request.system,
      "Return exactly one valid JSON object and no Markdown or explanatory text.",
      `JSON schema name: ${request.jsonSchema.name}`,
      request.jsonSchema.description
        ? `JSON schema description: ${request.jsonSchema.description}`
        : "",
      `JSON schema: ${JSON.stringify(request.jsonSchema.schema)}`,
      `Example JSON shape: ${JSON.stringify(example)}`,
      "Use the supplied facts for real values; do not copy placeholder example values.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let response: Response;
    try {
      response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json",
        },
        body: JSON.stringify({
model: DEEPSEEK_FLASH_MODEL,
thinking: { type: "disabled" },
temperature,
max_tokens: 4096,
messages: [
  { role: "system", content: system },
  { role: "user", content: request.prompt },
],
response_format: { type: "json_object" },
        }),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AiProviderError("aborted", "DeepSeek request was aborted.", {
cause: error,
        });
      }
      if (timeoutSignal.aborted) {
        throw new AiProviderError("timeout", "DeepSeek request timed out.", {
cause: error,
        });
      }
      throw new AiProviderError("provider_failure", "DeepSeek request failed.", {
        cause: error,
      });
    }

    const responseText = await response.text();
    let payload: ProviderResponse;
    try {
      payload = JSON.parse(responseText) as ProviderResponse;
    } catch (error) {
      throw new AiProviderError(
        "malformed_response",
        `DeepSeek returned malformed JSON: ${responseText.slice(0, 500)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const code: AiProviderErrorCode =
        response.status === 429
? "rate_limited"
: response.status >= 500
  ? "provider_failure"
  : "provider_rejected";
      const providerMessage = payload.error?.message || responseText.slice(0, 500);
      throw new AiProviderError(
        code,
        `DeepSeek rejected the request (${response.status}): ${providerMessage}`,
        { cause: payload.error },
      );
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new AiProviderError(
        "malformed_response",
        `DeepSeek returned empty structured content (finish_reason=${choice?.finish_reason ?? "unknown"}).`,
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
      decoded = omitUnexpectedNulls(
        decoded,
        request.jsonSchema.schema,
        request.jsonSchema.schema,
      );
    } catch (error) {
      throw new AiProviderError(
        "malformed_response",
        "DeepSeek returned invalid structured JSON.",
        { cause: error },
      );
    }

    const validated = request.validator.safeParse(decoded);
    if (!validated.success) {
      throw new AiProviderError(
        "validation",
        `DeepSeek structured output failed validation: ${validated.error.message}`,
      );
    }

    return {
      data: validated.data,
      requestedModel: DEEPSEEK_FLASH_MODEL,
      actualModel: payload.model || DEEPSEEK_FLASH_MODEL,
      providerRequestId: payload.id,
    };
  }
}
