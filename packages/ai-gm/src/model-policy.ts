export type AiTask =
  | "parse_intent"
  | "normalize_content"
  | "analyze_consumable"
  | "propose_adjudication"
  | "plan_npc"
  | "summarize_memory"
  | "brainstorm_content"
  | "narrate_event"
  | "private_assistant";

export type AiAuthority = "authoritative" | "creative";

export interface ModelPolicy {
  task: AiTask;
  authority: AiAuthority;
  model: string;
  allowUserOverride: boolean;
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
]);

export function createModelPolicy(input: {
  task: AiTask;
  authoritativeModel?: string;
  creativeModel?: string;
  requestedModel?: string;
}): ModelPolicy {
  const authority: AiAuthority = authoritativeTasks.has(input.task) ? "authoritative" : "creative";
  const configuredModel =
    authority === "authoritative" ? input.authoritativeModel : input.creativeModel;

  return {
    task: input.task,
    authority,
    model: input.requestedModel || configuredModel || "deepseek-v4-flash",
    allowUserOverride: false,
    requireStructuredOutput: authority === "authoritative" || input.task === "brainstorm_content",
    temperature: authority === "authoritative" ? 0.1 : 0.8,
  };
}
