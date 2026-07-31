import type { ZodType } from "zod";
import {
  DEFAULT_AI_MODEL,
  createModelPolicy,
  type AiAuthority,
  type AiTask,
} from "./model-policy.js";

export type AiProviderName = "deepseek" | "openai" | "openrouter" | "openai_compatible";
export type AiThinkingMode = "enabled" | "disabled" | "omit";

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface AiProviderTelemetry {
  task: AiTask;
  provider: AiProviderName;
  model: string;
  attempt: number;
  latencyMs: number;
  status: "success" | "error";
  errorCode?: AiProviderErrorCode;
}

export interface AiProviderConfig {
  provider?: AiProviderName;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  authoritativeModel?: string;
  creativeModel?: string;
  thinkingMode?: AiThinkingMode;
  timeoutMs?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  sendTemperature?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  logger?: (entry: AiProviderTelemetry) => void;
  /** Backward-compatible direct DeepSeek key used by older call sites. */
  deepseekApiKey?: string;
}

export interface ResolvedAiProviderConfig {
  provider: AiProviderName;
  apiKey?: string;
  baseUrl: string;
  model: string;
  authoritativeModel: string;
  creativeModel: string;
  thinkingMode: AiThinkingMode;
  timeoutMs: number;
  maxTokens: number;
  jsonMode: boolean;
  sendTemperature: boolean;
  extraHeaders: Record<string, string>;
  extraBody: Record<string, unknown>;
  logger?: (entry: AiProviderTelemetry) => void;
}

export interface StructuredGenerationRequest<T> {
  task: AiTask;
  system: string;
  prompt: string;
  jsonSchema: JsonSchemaDefinition;
  validator: ZodType<T>;
  /** Internal task override. This is never accepted directly from a player request. */
  requestedModel?: string;
  signal?: AbortSignal;
}

export interface StructuredGenerationResult<T> {
  data: T;
  requestedModel: string;
  actualModel: string;
  provider?: AiProviderName;
  providerRequestId?: string;
  attempts?: number;
  latencyMs?: number;
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

type Environment = Record<string, string | undefined>;

const PROVIDER_DEFAULTS: Record<AiProviderName, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: DEFAULT_AI_MODEL },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash" },
  openai_compatible: { baseUrl: "", model: DEFAULT_AI_MODEL },
};

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function configured(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseProvider(value: string | undefined): AiProviderName {
  const normalized = configured(value)?.toLowerCase();
  if (!normalized) return "deepseek";
  if (["deepseek", "openai", "openrouter", "openai_compatible"].includes(normalized)) {
    return normalized as AiProviderName;
  }
  throw new AiProviderError(
    "configuration",
    `Unsupported AI_PROVIDER ${JSON.stringify(value)}. Use deepseek, openai, openrouter, or openai_compatible.`,
  );
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

function parseJsonObject(value: string | undefined, field: string): Record<string, unknown> {
  if (!configured(value)) return {};
  try {
    const decoded = JSON.parse(value!);
    if (!object(decoded)) throw new Error("must be a JSON object");
    return decoded;
  } catch (error) {
    throw new AiProviderError("configuration", `${field} must contain a valid JSON object.`, {
      cause: error,
    });
  }
}

function providerApiKey(provider: AiProviderName, environment: Environment) {
  const generic = configured(environment.AI_API_KEY);
  if (generic) return generic;
  if (provider === "deepseek") return configured(environment.DEEPSEEK_API_KEY);
  if (provider === "openai") return configured(environment.OPENAI_API_KEY);
  if (provider === "openrouter") return configured(environment.OPENROUTER_API_KEY);
  return undefined;
}

function providerHeaders(provider: AiProviderName, environment: Environment) {
  const headers: Record<string, string> = {};
  if (provider === "openrouter") {
    const referer = configured(environment.AI_HTTP_REFERER || environment.OPENROUTER_HTTP_REFERER);
    const title = configured(environment.AI_APP_TITLE || environment.OPENROUTER_APP_TITLE);
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;
  }
  return headers;
}

export function resolveAiProviderConfigFromEnv(
  environment: Environment = process.env,
): ResolvedAiProviderConfig {
  const provider = parseProvider(environment.AI_PROVIDER);
  const defaults = PROVIDER_DEFAULTS[provider];
  const model =
    configured(environment.AI_MODEL) || configured(environment.DEEPSEEK_MODEL) || defaults.model;
  const baseUrl = configured(environment.AI_BASE_URL) || defaults.baseUrl;
  if (!baseUrl) {
    throw new AiProviderError(
      "configuration",
      "AI_BASE_URL is required when AI_PROVIDER=openai_compatible.",
    );
  }
  const thinkingSetting = configured(environment.AI_THINKING_MODE)?.toLowerCase();
  const thinkingMode: AiThinkingMode =
    thinkingSetting === "enabled" || thinkingSetting === "disabled" || thinkingSetting === "omit"
      ? thinkingSetting
      : provider === "deepseek"
        ? "disabled"
        : "omit";
  return {
    provider,
    apiKey: providerApiKey(provider, environment),
    baseUrl,
    model,
    authoritativeModel: configured(environment.AI_AUTHORITATIVE_MODEL) || model,
    creativeModel: configured(environment.AI_CREATIVE_MODEL) || model,
    thinkingMode,
    timeoutMs: parsePositiveInteger(environment.AI_TIMEOUT_MS, 60_000, 1_000, 300_000),
    maxTokens: parsePositiveInteger(environment.AI_MAX_TOKENS, 4_096, 128, 384_000),
    jsonMode: parseBoolean(environment.AI_JSON_MODE, true),
    sendTemperature: parseBoolean(environment.AI_SEND_TEMPERATURE, true),
    extraHeaders: providerHeaders(provider, environment),
    extraBody: parseJsonObject(environment.AI_EXTRA_BODY_JSON, "AI_EXTRA_BODY_JSON"),
  };
}

function resolveClientConfig(config: AiProviderConfig): ResolvedAiProviderConfig {
  const environmentConfig = resolveAiProviderConfigFromEnv();
  const provider = config.provider || environmentConfig.provider;
  const defaults = PROVIDER_DEFAULTS[provider];
  const model = configured(config.model) || environmentConfig.model || defaults.model;
  const baseUrl = configured(config.baseUrl) || environmentConfig.baseUrl || defaults.baseUrl;
  const apiKey =
    configured(config.apiKey) ||
    (provider === "deepseek" ? configured(config.deepseekApiKey) : undefined) ||
    environmentConfig.apiKey;
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    authoritativeModel:
      configured(config.authoritativeModel) || environmentConfig.authoritativeModel || model,
    creativeModel: configured(config.creativeModel) || environmentConfig.creativeModel || model,
    thinkingMode: config.thinkingMode || environmentConfig.thinkingMode,
    timeoutMs: config.timeoutMs || environmentConfig.timeoutMs,
    maxTokens: config.maxTokens || environmentConfig.maxTokens,
    jsonMode: config.jsonMode ?? environmentConfig.jsonMode,
    sendTemperature: config.sendTemperature ?? environmentConfig.sendTemperature,
    extraHeaders: { ...environmentConfig.extraHeaders, ...(config.extraHeaders || {}) },
    extraBody: { ...environmentConfig.extraBody, ...(config.extraBody || {}) },
    logger: config.logger,
  };
}

export function createAiProviderClientFromEnv(environment: Environment = process.env) {
  const resolved = resolveAiProviderConfigFromEnv(environment);
  return new AiProviderClient(resolved);
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

function numericExample(resolved: JsonObject, integer: boolean): number {
  if (typeof resolved.minimum === "number") return resolved.minimum;
  if (typeof resolved.exclusiveMinimum === "number") {
    return integer ? Math.floor(resolved.exclusiveMinimum) + 1 : resolved.exclusiveMinimum + 0.1;
  }
  return 0;
}

function exampleFromSchema(schema: unknown, root: JsonObject, depth = 0): unknown {
  if (depth > 8) return null;
  const resolved = resolveSchema(schema, root);
  if (!resolved) return null;
  if ("const" in resolved) return resolved.const;
  if ("default" in resolved) return resolved.default;
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
  if (type === "integer") return numericExample(resolved, true);
  if (type === "number") return numericExample(resolved, false);
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (type === "string" && typeof resolved.minLength === "number" && resolved.minLength > 0) {
    return "x".repeat(Math.min(resolved.minLength, 32));
  }
  return "<string>";
}

function structuredRepairPrompt<T>(
  request: StructuredGenerationRequest<T>,
  error: AiProviderError,
): string | null {
  if (error.code === "validation" && object(error.cause)) {
    const decoded = JSON.stringify(error.cause.decoded ?? null).slice(0, 8_000);
    const issues = JSON.stringify(error.cause.issues ?? []).slice(0, 4_000);
    return `${request.prompt}\n\nCORRECTION REQUIRED:\nThe previous JSON object failed validation. Return a corrected complete object, not a patch.\nValidation issues: ${issues}\nPrevious JSON: ${decoded}`;
  }
  if (error.code === "malformed_response") {
    return `${request.prompt}\n\nCORRECTION REQUIRED:\nThe previous response was not parseable as one complete JSON object. Return the complete object again. Start with { and end with }. Do not use Markdown fences, commentary, XML tags, or any text before or after the JSON object.`;
  }
  return null;
}

function balancedJsonObjects(content: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
        if (candidates.length >= 8) break;
      }
    }
  }
  return candidates;
}

function decodeStructuredContent(content: string): unknown {
  const normalized = content.replace(/^\uFEFF/, "").trim();
  const candidates = [normalized];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fencePattern.exec(normalized)) && candidates.length < 8) {
    const fenced = fenceMatch[1]?.trim();
    if (fenced) candidates.push(fenced);
  }
  candidates.push(...balancedJsonObjects(normalized));

  let lastError: unknown;
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new SyntaxError("No JSON object was found in structured provider content.");
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export class AiProviderClient {
  private readonly resolved: ResolvedAiProviderConfig;

  constructor(config: AiProviderConfig = {}) {
    this.resolved = resolveClientConfig(config);
  }

  getConfiguration() {
    return {
      provider: this.resolved.provider,
      baseUrl: this.resolved.baseUrl,
      model: this.resolved.model,
      authoritativeModel: this.resolved.authoritativeModel,
      creativeModel: this.resolved.creativeModel,
      thinkingMode: this.resolved.thinkingMode,
      maxTokens: this.resolved.maxTokens,
      timeoutMs: this.resolved.timeoutMs,
      jsonMode: this.resolved.jsonMode,
      configured: Boolean(this.resolved.apiKey),
    };
  }

  getModelForTask(task: AiTask, requestedModel?: string) {
    return createModelPolicy({
      task,
      authoritativeModel: this.resolved.authoritativeModel,
      creativeModel: this.resolved.creativeModel,
      requestedModel,
    }).model;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    retries = 1,
  ): Promise<StructuredGenerationResult<T>> {
    const policy = createModelPolicy({
      task: request.task,
      authoritativeModel: this.resolved.authoritativeModel,
      creativeModel: this.resolved.creativeModel,
      requestedModel: request.requestedModel,
    });
    const startedAt = Date.now();
    let lastError: unknown;
    let activeRequest = request;

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const result = await this.callProvider(
          activeRequest,
          policy.authority,
          policy.model,
          policy.temperature,
        );
        this.resolved.logger?.({
          task: request.task,
          provider: this.resolved.provider,
          model: policy.model,
          attempt,
          latencyMs: Date.now() - attemptStartedAt,
          status: "success",
        });
        return {
          ...result,
          provider: this.resolved.provider,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const code = error instanceof AiProviderError ? error.code : "provider_failure";
        this.resolved.logger?.({
          task: request.task,
          provider: this.resolved.provider,
          model: policy.model,
          attempt,
          latencyMs: Date.now() - attemptStartedAt,
          status: "error",
          errorCode: code,
        });
        if (!isTransientAiProviderError(error) || attempt > retries) throw error;
        if (error instanceof AiProviderError) {
          const repairedPrompt = structuredRepairPrompt(request, error);
          if (repairedPrompt) activeRequest = { ...request, prompt: repairedPrompt };
        }
      }
    }
    throw lastError;
  }

  private async callProvider<T>(
    request: StructuredGenerationRequest<T>,
    _authority: AiAuthority,
    model: string,
    temperature: number,
  ): Promise<Omit<StructuredGenerationResult<T>, "provider" | "attempts" | "latencyMs">> {
    const apiKey = this.resolved.apiKey;
    if (!apiKey) {
      throw new AiProviderError(
        "configuration",
        `No API key is configured for AI_PROVIDER=${this.resolved.provider}. Set AI_API_KEY or the provider-specific key.`,
      );
    }

    const timeoutSignal = AbortSignal.timeout(this.resolved.timeoutMs);
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

    const body: Record<string, unknown> = {
      ...this.resolved.extraBody,
      model,
      max_tokens: this.resolved.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: request.prompt },
      ],
    };
    if (this.resolved.sendTemperature) body.temperature = temperature;
    if (this.resolved.jsonMode) body.response_format = { type: "json_object" };
    if (this.resolved.thinkingMode !== "omit") {
      body.thinking = { type: this.resolved.thinkingMode };
    }

    let response: Response;
    try {
      response = await fetch(chatCompletionsUrl(this.resolved.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...this.resolved.extraHeaders,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AiProviderError("aborted", "AI provider request was aborted.", {
          cause: error,
        });
      }
      if (timeoutSignal.aborted) {
        throw new AiProviderError("timeout", "AI provider request timed out.", {
          cause: error,
        });
      }
      throw new AiProviderError("provider_failure", "AI provider request failed.", {
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
        `AI provider returned malformed response-envelope JSON (content_length=${responseText.length}).`,
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
      const providerMessage =
        payload.error?.message || `response body length ${responseText.length}`;
      throw new AiProviderError(
        code,
        `${this.resolved.provider} rejected model ${model} (${response.status}): ${providerMessage}`,
        { cause: payload.error },
      );
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new AiProviderError(
        "malformed_response",
        `AI provider returned empty structured content (finish_reason=${choice?.finish_reason ?? "unknown"}).`,
      );
    }

    let decoded: unknown;
    try {
      decoded = decodeStructuredContent(content);
      decoded = omitUnexpectedNulls(decoded, request.jsonSchema.schema, request.jsonSchema.schema);
    } catch (error) {
      throw new AiProviderError(
        "malformed_response",
        `AI provider returned invalid structured JSON (finish_reason=${choice?.finish_reason ?? "unknown"}, content_length=${content.length}, fenced=${/^\s*```/.test(content)}).`,
        {
          cause: {
            parseError: error instanceof Error ? error.message : String(error),
            finishReason: choice?.finish_reason ?? null,
            contentLength: content.length,
            fenced: /^\s*```/.test(content),
          },
        },
      );
    }

    const validated = request.validator.safeParse(decoded);
    if (!validated.success) {
      throw new AiProviderError(
        "validation",
        `AI provider structured output failed validation: ${validated.error.message}`,
        { cause: { decoded, issues: validated.error.issues } },
      );
    }

    return {
      data: validated.data,
      requestedModel: model,
      actualModel: payload.model || model,
      providerRequestId: payload.id,
    };
  }
}
