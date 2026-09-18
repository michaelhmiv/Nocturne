export type AiTask =
  | "parse_intent"
  | "normalize_content"
  | "analyze_consumable"
  | "propose_adjudication"
  | "plan_npc"
  | "summarize_memory"
  | "brainstorm_content"
  | "narrate_event"
  | "private_assistant"
  | "resolve_entity_references"
  | "analyze_materialization"
  | "analyze_search_discovery"
  | "assess_environmental_affordances"
  | "plan_persistent_world_action"
  | "simulate_entity_elapsed_time";

export type AiAuthority = "authoritative" | "creative";
export const DEFAULT_AI_MODEL = "deepseek-v4-flash";
export const DEFAULT_GENERATIVE_MODEL = "qwen/qwen3.7-flash";
export const DEFAULT_NARRATION_MODEL = "poolside/laguna-xs-2.1";
/** Compatibility alias retained for older direct-DeepSeek callers and stored telemetry. */
export const DEEPSEEK_FLASH_MODEL = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_AI_MODEL;

export function configuredGenerativeModel(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.AI_GENERATIVE_MODEL?.trim() ||
    environment.AI_MODEL?.trim() ||
    environment.DEEPSEEK_MODEL?.trim() ||
    DEFAULT_GENERATIVE_MODEL
  );
}

export interface ModelPolicy {
  task: AiTask;
  authority: AiAuthority;
  model: string;
  allowUserOverride: false;
  requireStructuredOutput: boolean;
  temperature: number;
}

const authoritativeTasks = new Set<AiTask>([
  "parse_intent",
  "normalize_content",
  "analyze_consumable",
  "propose_adjudication",
  "plan_npc",
  "summarize_memory",
  "resolve_entity_references",
  "analyze_materialization",
  "analyze_search_discovery",
  "assess_environmental_affordances",
  "plan_persistent_world_action",
  "simulate_entity_elapsed_time",
]);

const configured = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

export function createModelPolicy(input: {
  task: AiTask;
  authoritativeModel?: string;
  creativeModel?: string;
  requestedModel?: string;
}): ModelPolicy {
  const authority: AiAuthority = authoritativeTasks.has(input.task) ? "authoritative" : "creative";
  const configuredModel =
    authority === "authoritative"
      ? configured(input.authoritativeModel)
      : configured(input.creativeModel);
  return {
    task: input.task,
    authority,
    model: configured(input.requestedModel) || configuredModel || configuredGenerativeModel(),
    allowUserOverride: false,
    requireStructuredOutput: authority === "authoritative" || input.task === "brainstorm_content",
    temperature: authority === "authoritative" ? 0.1 : 0.8,
  };
}
