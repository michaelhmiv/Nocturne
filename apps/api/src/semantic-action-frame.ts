import {
  SemanticActionFrameSchema,
  type RelevanceCompiledContext,
  type SemanticActionFrame,
  type WorldActionKind,
} from "@nocturne/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const routineSelfDirectedPatterns = [
  /\bpush[ -]?ups?\b/i,
  /\bsit(?: down)?\b/i,
  /\bstand(?: up)?\b/i,
  /\bstretch\b/i,
  /\bblink\b/i,
  /\bbreathe\b/i,
  /\bclap\b/i,
  /\bwave\b/i,
  /\bsmile\b/i,
  /\bnod\b/i,
  /\bkneel\b/i,
  /\blie down\b/i,
];

const destructivePattern = /\b(?:break|destroy|smash|rip|tear|burn|cut|damage|wreck|demolish)\b/i;
const illegalPattern =
  /\b(?:steal|rob|break in|trespass|bribe|forge|hack|assault|murder|kidnap)\b/i;
const continuousPattern = /\b(?:for|over)\s+\d+\s*(?:seconds?|minutes?|hours?|days?)\b/i;
const highEffortPattern =
  /\b(?:one[- ]arm|hundred|100|marathon|maximum|until failure|exhausted|heavy)\b/i;
const technicalPattern = /\b(?:hack|repair|build|craft|wire|program|forge|pick the lock|disarm)\b/i;
const precisionPattern =
  /\b(?:carefully|precisely|surgically|without spilling|without being seen|bullseye)\b/i;
const dangerPattern = /\b(?:fire|explosive|live wire|gun|weapon|poison|traffic|roof|ledge)\b/i;
const pressurePattern =
  /\b(?:before|within|in less than|quickly|immediately|right now|countdown)\b/i;

function firstString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function collectUuidValues(value: unknown, values = new Set<string>()) {
  if (typeof value === "string") {
    if (uuidPattern.test(value)) values.add(value);
    return values;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUuidValues(item, values);
    return values;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectUuidValues(nested, values);
  }
  return values;
}

function normalizedActionType(
  kind: WorldActionKind,
  rawText: string,
  payload: Record<string, unknown>,
) {
  const supplied = firstString(payload, ["actionType", "verb", "intent"]);
  if (supplied && /^[a-z][a-z0-9_]{0,63}$/.test(supplied)) return supplied;
  if (/\bpush[ -]?ups?\b/i.test(rawText)) return "exercise";
  if (/\b(?:sit|stand|stretch|blink|breathe|clap|wave|smile|nod|kneel|lie down)\b/i.test(rawText)) {
    return "routine_body_action";
  }
  if (/\b(?:open|close|turn on|turn off|pick up|put down|use)\b/i.test(rawText)) {
    return "interact";
  }
  if (kind === "combat") return /\barrest|restrain\b/i.test(rawText) ? "arrest" : "attack";
  if (kind === "dialogue") return "talk";
  if (kind === "question") return "ask";
  return kind;
}

function durationFromText(rawText: string) {
  const match = /\b(?:for|over)\s+(\d+)\s*(seconds?|minutes?|hours?|days?)\b/i.exec(rawText);
  if (!match) return undefined;
  const amount = Number(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multiplier = unit.startsWith("second")
    ? 1
    : unit.startsWith("minute")
      ? 60
      : unit.startsWith("hour")
        ? 3_600
        : 86_400;
  return Math.min(31_536_000, Math.max(1, Math.round(amount * multiplier)));
}

function quantityFromText(rawText: string) {
  const pushup = /\b(?:do\s+)?(one|a|an|\d+)\s+push[ -]?ups?\b/i.exec(rawText);
  if (!pushup) return undefined;
  const quantityText = pushup[1]!;
  if (["one", "a", "an"].includes(quantityText.toLowerCase())) return 1;
  const quantity = Number(quantityText);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

function objectiveFromRawText(rawText: string) {
  const trimmed = rawText.trim().replace(/[.!?]+$/, "");
  return trimmed || "Perform the requested action";
}

export function deriveSemanticActionFrame(input: {
  kind: WorldActionKind;
  actorId: string;
  rawText: string;
  payload?: Record<string, unknown>;
  resolvedReferences?: Record<string, unknown>;
  context?: RelevanceCompiledContext;
}): SemanticActionFrame {
  const payload = input.payload || {};
  const supplied = SemanticActionFrameSchema.safeParse(payload.actionFrame);
  if (
    supplied.success &&
    supplied.data.actorId === input.actorId &&
    supplied.data.kind === input.kind
  ) {
    return supplied.data;
  }

  const referencedIds = collectUuidValues(input.resolvedReferences || {});
  for (const id of collectUuidValues(payload)) referencedIds.add(id);
  referencedIds.delete(input.actorId);
  const visibleIds = new Set((input.context?.entities ?? []).map(({ entityId }) => entityId));
  const targetIds = [...referencedIds].filter((id) => visibleIds.size === 0 || visibleIds.has(id));
  const routineSelfDirected = routineSelfDirectedPatterns.some((pattern) =>
    pattern.test(input.rawText),
  );
  const kindImpliesOpposition = ["combat", "relationship", "transfer"].includes(input.kind);
  const opposed = Boolean(payload.opposed) || kindImpliesOpposition || targetIds.length > 0;
  const selfDirected = routineSelfDirected && targetIds.length === 0;
  const durationSeconds =
    numberValue(payload, "durationSeconds") || durationFromText(input.rawText);
  const quantity = numberValue(payload, "quantity") || quantityFromText(input.rawText);
  const physicalEffort = highEffortPattern.test(input.rawText)
    ? 7
    : /\bpush[ -]?ups?|run|lift|climb|jump|fight|attack\b/i.test(input.rawText)
      ? quantity && quantity > 20
        ? 5
        : 2
      : 1;
  const locationId = firstString(payload, ["locationId"]);

  return SemanticActionFrameSchema.parse({
    kind: input.kind,
    actionType: normalizedActionType(input.kind, input.rawText, payload),
    objective:
      firstString(payload, ["objective", "desiredOutcome"]) || objectiveFromRawText(input.rawText),
    actorId: input.actorId,
    targetIds,
    objectIds: [],
    toolIds: [],
    ...(locationId ? { locationId } : {}),
    ...(quantity ? { quantity } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
    properties: {
      selfDirected,
      opposed,
      destructive: destructivePattern.test(input.rawText),
      illegal: illegalPattern.test(input.rawText),
      social: ["dialogue", "question", "relationship"].includes(input.kind),
      movement: input.kind === "move",
      continuous: Boolean(durationSeconds) || continuousPattern.test(input.rawText),
    },
    demands: {
      physicalEffort,
      technicalComplexity: technicalPattern.test(input.rawText) ? 5 : 0,
      precision: precisionPattern.test(input.rawText) ? 4 : 0,
      danger: dangerPattern.test(input.rawText) ? 5 : input.kind === "combat" ? 4 : 0,
      timePressure: pressurePattern.test(input.rawText) ? 4 : 0,
    },
    assumptions: [],
    ambiguities: [],
  });
}

export function isRoutineSelfDirectedAction(frame: SemanticActionFrame) {
  return (
    frame.properties.selfDirected &&
    !frame.properties.opposed &&
    !frame.properties.destructive &&
    !frame.properties.illegal &&
    !frame.properties.continuous &&
    frame.demands.physicalEffort <= 2 &&
    frame.demands.technicalComplexity <= 1 &&
    frame.demands.precision <= 1 &&
    frame.demands.danger <= 1 &&
    frame.demands.timePressure <= 1 &&
    frame.ambiguities.length === 0
  );
}
