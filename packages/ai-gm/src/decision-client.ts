import { AiProviderError, type AiProviderErrorCode } from "./ai-provider.js";

export const DEFAULT_DECISION_MODEL = "~typesafe/jev-latest";
export const DEFAULT_DECISION_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

export type DecisionState = string | string[] | Record<string, unknown>;

export type DecisionCriterion = string | Record<string, unknown> | unknown[];

export type DecisionChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, DecisionCriterion>;
};

export type DecisionScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: DecisionCriterion[];
};

export type DecisionNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: {
    true: DecisionCriterion;
    false: DecisionCriterion;
  };
};

export type DecisionQuestion =
  DecisionChoiceQuestion | DecisionScoreQuestion | DecisionNoulQuestion;

export type DecisionChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type DecisionScoreAnswer = {
  type: "score";
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, DecisionCriterion>;
};

export type DecisionNoulAnswer = {
  type: "noul";
  noul: number;
};

export type DecisionAnswer = DecisionChoiceAnswer | DecisionScoreAnswer | DecisionNoulAnswer;

export type DecisionAnswers<TQuestions extends Record<string, DecisionQuestion>> = {
  [K in keyof TQuestions]: TQuestions[K] extends DecisionChoiceQuestion
    ? DecisionChoiceAnswer
    : TQuestions[K] extends DecisionScoreQuestion
      ? DecisionScoreAnswer
      : DecisionNoulAnswer;
};

export interface AiDecisionTelemetry {
  task: string;
  provider: "openrouter";
  model: string;
  latencyMs: number;
  status: "success" | "error";
  errorCode?: AiProviderErrorCode;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export interface AiDecisionClientConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logger?: (entry: AiDecisionTelemetry) => void;
}

export interface ResolvedAiDecisionClientConfig {
  apiKey?: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  extraHeaders: Record<string, string>;
  logger?: (entry: AiDecisionTelemetry) => void;
}

type Environment = Record<string, string | undefined>;

type DecisionEnvelope = {
  id?: string;
  model?: string;
  answers?: Record<string, DecisionAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
  error?: { message?: string; type?: string; code?: string | number };
};

const configured = (value: string | undefined) => value?.trim() || undefined;

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

function openRouterHeaders(environment: Environment) {
  const headers: Record<string, string> = {};
  const referer = configured(environment.AI_HTTP_REFERER || environment.OPENROUTER_HTTP_REFERER);
  const title = configured(environment.AI_APP_TITLE || environment.OPENROUTER_APP_TITLE);
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return headers;
}

export function resolveAiDecisionConfigFromEnv(
  environment: Environment = process.env,
): ResolvedAiDecisionClientConfig {
  return {
    apiKey:
      configured(environment.AI_DECISION_API_KEY) ||
      configured(environment.OPENROUTER_API_KEY) ||
      configured(environment.AI_API_KEY),
    model: configured(environment.AI_DECISION_MODEL) || DEFAULT_DECISION_MODEL,
    endpoint: configured(environment.AI_DECISION_ENDPOINT) || DEFAULT_DECISION_ENDPOINT,
    timeoutMs: parsePositiveInteger(environment.AI_DECISION_TIMEOUT_MS, 5_000, 250, 30_000),
    extraHeaders: openRouterHeaders(environment),
  };
}

function resolveConfig(config: AiDecisionClientConfig): ResolvedAiDecisionClientConfig {
  const environment = resolveAiDecisionConfigFromEnv();
  return {
    apiKey: configured(config.apiKey) || environment.apiKey,
    model: configured(config.model) || environment.model,
    endpoint: configured(config.endpoint) || environment.endpoint,
    timeoutMs: config.timeoutMs ?? environment.timeoutMs,
    extraHeaders: { ...environment.extraHeaders, ...(config.extraHeaders || {}) },
    logger: config.logger,
  };
}

export function createAiDecisionClientFromEnv(environment: Environment = process.env) {
  const resolved = resolveAiDecisionConfigFromEnv(environment);
  return new AiDecisionClient(resolved);
}

export function requireDecisionChoice(
  answer: DecisionAnswer | undefined,
  questionId: string,
): DecisionChoiceAnswer {
  if (!answer || answer.type !== "choice") {
    throw new AiProviderError(
      "malformed_response",
      `Jev decision response is missing choice answer ${questionId}.`,
    );
  }
  return answer;
}

export function requireDecisionScore(
  answer: DecisionAnswer | undefined,
  questionId: string,
): DecisionScoreAnswer {
  if (!answer || answer.type !== "score") {
    throw new AiProviderError(
      "malformed_response",
      `Jev decision response is missing score answer ${questionId}.`,
    );
  }
  return answer;
}

export function requireDecisionNoul(
  answer: DecisionAnswer | undefined,
  questionId: string,
): DecisionNoulAnswer {
  if (!answer || answer.type !== "noul") {
    throw new AiProviderError(
      "malformed_response",
      `Jev decision response is missing Noul answer ${questionId}.`,
    );
  }
  return answer;
}

function validateQuestionAnswer(question: DecisionQuestion, answer: DecisionAnswer | undefined) {
  if (!answer) {
    throw new AiProviderError(
      "malformed_response",
      `Jev decision response is missing a ${question.type} answer.`,
    );
  }

  switch (question.type) {
    case "choice": {
      const choice = requireDecisionChoice(answer, "choice");
      if (!Object.prototype.hasOwnProperty.call(question.criteria, choice.choice)) {
        throw new AiProviderError(
          "validation",
          `Jev selected an unknown choice ${JSON.stringify(choice.choice)}.`,
        );
      }
      if (
        choice.confidence !== undefined &&
        (!Number.isFinite(choice.confidence) || choice.confidence < 0 || choice.confidence > 1)
      ) {
        throw new AiProviderError("validation", "Jev returned invalid choice confidence.");
      }
      return;
    }
    case "score": {
      if (answer.type !== "score") {
        throw new AiProviderError(
          "malformed_response",
          "Jev decision response is missing a score answer.",
        );
      }
      if (
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > Math.max(0, question.criteria.length - 1)
      ) {
        throw new AiProviderError("validation", "Jev returned an out-of-range score.");
      }
      return;
    }
    case "noul": {
      const noul = requireDecisionNoul(answer, "noul");
      if (!Number.isFinite(noul.noul) || noul.noul < 0 || noul.noul > 1) {
        throw new AiProviderError("validation", "Jev returned an invalid Noul probability.");
      }
    }
  }
}

export class AiDecisionClient {
  private readonly resolved: ResolvedAiDecisionClientConfig;

  constructor(config: AiDecisionClientConfig = {}) {
    this.resolved = resolveConfig(config);
  }

  getConfiguration() {
    return {
      provider: "openrouter" as const,
      model: this.resolved.model,
      endpoint: this.resolved.endpoint,
      timeoutMs: this.resolved.timeoutMs,
      configured: Boolean(this.resolved.apiKey),
    };
  }

  async decide<TQuestions extends Record<string, DecisionQuestion>>(request: {
    task: string;
    state: DecisionState;
    questions: TQuestions;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{
    answers: DecisionAnswers<TQuestions>;
    requestedModel: string;
    actualModel: string;
    provider: "openrouter";
    providerRequestId?: string;
    latencyMs: number;
    usage?: DecisionEnvelope["usage"];
  }> {
    const apiKey = this.resolved.apiKey;
    const model = configured(request.model) || this.resolved.model;
    if (!apiKey) {
      throw new AiProviderError(
        "configuration",
        "No OpenRouter credential is configured for Jev. Set AI_DECISION_API_KEY, OPENROUTER_API_KEY, or AI_API_KEY.",
      );
    }

    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(this.resolved.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(this.resolved.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...this.resolved.extraHeaders,
        },
        body: JSON.stringify({
          model,
          state: request.state,
          questions: request.questions,
        }),
        signal,
      });
    } catch (error) {
      const code: AiProviderErrorCode = request.signal?.aborted
        ? "aborted"
        : timeoutSignal.aborted
          ? "timeout"
          : "provider_failure";
      this.resolved.logger?.({
        task: request.task,
        provider: "openrouter",
        model,
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorCode: code,
      });
      throw new AiProviderError(
        code,
        code === "timeout" ? "Jev decision request timed out." : "Jev decision request failed.",
        { cause: error },
      );
    }

    const responseText = await response.text();
    let payload: DecisionEnvelope;
    try {
      payload = JSON.parse(responseText) as DecisionEnvelope;
    } catch (error) {
      throw new AiProviderError(
        "malformed_response",
        `Jev returned malformed response-envelope JSON (content_length=${responseText.length}).`,
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
      this.resolved.logger?.({
        task: request.task,
        provider: "openrouter",
        model,
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorCode: code,
      });
      throw new AiProviderError(
        code,
        `OpenRouter rejected Jev model ${model} (${response.status}): ${providerMessage}`,
        { cause: payload.error },
      );
    }

    if (!payload.answers || typeof payload.answers !== "object") {
      throw new AiProviderError("malformed_response", "Jev returned no decision answers.");
    }

    for (const [id, question] of Object.entries(request.questions)) {
      validateQuestionAnswer(question, payload.answers[id]);
    }

    const latencyMs = Date.now() - startedAt;
    this.resolved.logger?.({
      task: request.task,
      provider: "openrouter",
      model,
      latencyMs,
      status: "success",
      inputTokens: payload.usage?.input_tokens,
      outputTokens: payload.usage?.output_tokens,
      cost: payload.usage?.cost,
    });

    return {
      answers: payload.answers as DecisionAnswers<TQuestions>,
      requestedModel: model,
      actualModel: payload.model || model,
      provider: "openrouter",
      providerRequestId: payload.id,
      latencyMs,
      usage: payload.usage,
    };
  }
}
