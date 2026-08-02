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

type ReferenceBuckets = {
  targets: Set<string>;
  objects: Set<string>;
  tools: Set<string>;
  unclassified: Set<string>;
};

function referenceBucket(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (/(?:tool|method|weapon|instrument)/.test(normalized)) return "tools" as const;
  if (/(?:object|item|asset|vehicle|device|equipment|source)/.test(normalized)) {
    return "objects" as const;
  }
  if (/(?:target|recipient|subject|opponent|person|npc|character|holder|possessor)/.test(normalized)) {
    return "targets" as const;
  }
  return "unclassified" as const;
}

function collectReferenceIds(
  value: unknown,
  buckets: ReferenceBuckets,
  key = "",
): ReferenceBuckets {
  if (typeof value === "string") {
    if (uuidPattern.test(value)) buckets[referenceBucket(key)].add(value);
    return buckets;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceIds(item, buckets, key);
    return buckets;
  }
  if (value && typeof value === "object") {
    for (const [nestedKey, nested] of Object.entries(value)) {
      collectReferenceIds(nested, buckets, nestedKey);
    }
  }
  return buckets;
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

  const buckets: ReferenceBuckets = {
    targets: new Set(),
    objects: new Set(),
    tools: new Set(),
    unclassified: new Set(),
  };
  collectReferenceIds(input.resolvedReferences || {}, buckets);
  collectReferenceIds(payload, buckets);
  for (const bucket of Object.values(buckets)) bucket.delete(input.actorId);

  const contextById = new Map(
    (input.context?.entities ?? []).map((entity) => [entity.entityId, entity]),
  );
  for (const id of buckets.unclassified) {
    const definitionType = contextById.get(id)?.definitionType.toLowerCase() || "";
    if (/(?:item|object|device|vehicle|equipment|weapon|tool)/.test(definitionType)) {
      buckets.objects.add(id);
    } else if (/(?:character|npc|person|creature)/.test(definitionType)) {
      buckets.targets.add(id);
    }
  }
  const visible = (id: string) => contextById.size === 0 || contextById.has(id);
  const targetIds = [...buckets.targets].filter(visible);
  const objectIds = [...buckets.objects].filter(visible);
  const toolIds = [...buckets.tools].filter(visible);

  const routineSelfDirected = routineSelfDirectedPatterns.some((pattern) =>
    pattern.test(input.rawText),
  );
  const kindImpliesOpposition = ["combat", "relationship"].includes(input.kind);
  const transferResistance = input.kind === "transfer" && illegalPattern.test(input.rawText);
  const opposed = Boolean(payload.opposed) || kindImpliesOpposition || transferResistance;
  const selfDirected = routineSelfDirected && targetIds.length === 0 && objectIds.length === 0;
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
    objectIds,
    toolIds,
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
