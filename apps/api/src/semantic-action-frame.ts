import {
  SemanticActionFrameSchema,
  type RelevanceCompiledContext,
  type SemanticActionClaim,
  type SemanticActionFrame,
  type SemanticEntityReference,
  type SemanticReferenceRole,
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
const dangerPattern =
  /\b(?:fire|explosive|live wire|gun|weapon|knife|knives|blade|razor|poison|traffic|roof|ledge)\b/i;
const harmfulContactPattern =
  /\b(?:strike|hit|slam|bang|stab|cut|burn|shoot|poison|choke|electrocute|crash)\b/i;
const selfBodyReferencePattern =
  /\b(?:myself|my own body|my (?:head|forehead|face|neck|chest|body|hand|arm|leg|foot))\b/i;
const pressurePattern =
  /\b(?:before|within|in less than|quickly|immediately|right now|countdown)\b/i;
const deicticLocationPattern =
  /\b(?:(?:this|the current|my current)\s+(room|apartment|unit|building|location)|here)\b/i;
const anatomyPattern =
  /\b(?:bare\s+)?(?:my\s+)?(fists?|hands?|head|forehead|face|neck|chest|body|arms?|legs?|feet|foot|elbows?|knees?)\b/gi;
const possessionToolPattern =
  /\b(?:gun|pistol|rifle|shotgun|knife|knives|blade|razor|hammer|crowbar|tool|weapon)\b/i;
const intrinsicAnatomyNames = new Set([
  "fist",
  "hand",
  "head",
  "forehead",
  "face",
  "neck",
  "chest",
  "body",
  "arm",
  "leg",
  "foot",
  "elbow",
  "knee",
]);

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

function stringArray(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
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
  if (
    /(?:target|recipient|subject|opponent|person|npc|character|holder|possessor)/.test(normalized)
  ) {
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

function cleanPossessionName(value: string) {
  return value
    .toLowerCase()
    .replace(/^(?:a|an|the|my|some)\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9' -]/g, "")
    .trim();
}

function slugPart(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 44);
  return normalized || "reference";
}

function normalizeAnatomy(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "fists") return "fist";
  if (normalized === "hands") return "hand";
  if (normalized === "arms") return "arm";
  if (normalized === "legs") return "leg";
  if (normalized === "feet") return "foot";
  if (normalized === "elbows") return "elbow";
  if (normalized === "knees") return "knee";
  return normalized;
}

function isIntrinsicAnatomyPhrase(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/\b(?:bare|my|own)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.includes(" ")) return false;
  return intrinsicAnatomyNames.has(normalizeAnatomy(normalized));
}

function explicitPossessionNames(rawText: string) {
  const names = new Set<string>();
  const patterns = [
    /\b(?:holding|carrying|wielding|armed with|equipped with|using)\s+(?:a|an|the|my|some)?\s*([a-z][a-z0-9' -]{0,50}?)(?=$|[,.!?]|\s+(?:to|while|and|but|then)\b)/gi,
    /\bwith\s+(?:a|an|the|my|some)?\s*([a-z][a-z0-9' -]{0,50}?)(?=$|[,.!?]|\s+(?:while|and|but|then)\b)/gi,
    /\b(?:the|a|an|my)\s+([a-z][a-z0-9' -]{0,50}?)\s+(?:from|in)\s+my\s+inventory\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of rawText.matchAll(pattern)) {
      const name = cleanPossessionName(match[1] || "");
      if (name && !isIntrinsicAnatomyPhrase(name)) names.add(name);
    }
  }
  return [...names];
}

function explicitAnatomyNames(rawText: string) {
  const names = new Set<string>();
  for (const match of rawText.matchAll(anatomyPattern)) {
    const name = normalizeAnatomy(match[1] || "");
    if (name) names.add(name);
  }
  return [...names];
}

function resolvedReference(input: {
  referenceKey: string;
  entityId: string;
  role: SemanticReferenceRole;
  contextById: Map<string, RelevanceCompiledContext["entities"][number]>;
}): SemanticEntityReference {
  const entity = input.contextById.get(input.entityId);
  const name = entity?.name || input.entityId;
  return {
    referenceKey: input.referenceKey,
    originalText: name,
    normalizedText: name.toLowerCase(),
    role: input.role,
    required: true,
    relationship: input.role === "tool" ? "possessed" : "visible",
    resolution: "resolved_entity",
    resolvedEntityId: input.entityId,
    candidateEntityIds: [],
    allowClarification: true,
  };
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
  const explicitSelfDirected = selfBodyReferencePattern.test(input.rawText);
  const kindImpliesOpposition = ["combat", "relationship"].includes(input.kind);
  const transferResistance = input.kind === "transfer" && illegalPattern.test(input.rawText);
  const opposed = Boolean(payload.opposed) || kindImpliesOpposition || transferResistance;
  const selfDirected =
    (routineSelfDirected || explicitSelfDirected) &&
    targetIds.length === 0 &&
    objectIds.length === 0;
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
  const explicitLocationId = firstString(payload, ["locationId"]);
  const actorLocationId = contextById.get(input.actorId)?.locationId || undefined;
  const deicticLocation = deicticLocationPattern.exec(input.rawText)?.[0];
  const locationId = explicitLocationId || (deicticLocation ? actorLocationId : undefined);
  const selfHarmDanger = explicitSelfDirected && harmfulContactPattern.test(input.rawText);
  const danger = selfHarmDanger
    ? 7
    : dangerPattern.test(input.rawText)
      ? 5
      : input.kind === "combat"
        ? 4
        : 0;

  const anatomyNames = explicitAnatomyNames(input.rawText);
  const possessionNames = explicitPossessionNames(input.rawText);
  const assumptions = [
    ...stringArray(payload, "assumptions"),
    ...possessionNames.map((name) => `requires_possession:${name}`),
  ];

  const references: SemanticEntityReference[] = [
    ...targetIds.map((entityId, index) =>
      resolvedReference({
        referenceKey: `target_${index + 1}`,
        entityId,
        role: "target",
        contextById,
      }),
    ),
    ...objectIds.map((entityId, index) =>
      resolvedReference({
        referenceKey: `object_${index + 1}`,
        entityId,
        role: "object",
        contextById,
      }),
    ),
    ...toolIds.map((entityId, index) =>
      resolvedReference({
        referenceKey: `tool_${index + 1}`,
        entityId,
        role: "tool",
        contextById,
      }),
    ),
  ];
  const claims: SemanticActionClaim[] = [];

  for (const name of possessionNames) {
    const key = `possession_${slugPart(name)}`;
    references.push({
      referenceKey: key,
      originalText: name,
      normalizedText: name,
      role: possessionToolPattern.test(name) ? "tool" : "object",
      required: true,
      relationship: "possessed",
      resolution: "unresolved",
      candidateEntityIds: [],
      allowClarification: false,
    });
    claims.push({
      claimKey: key,
      claimType: "possession",
      sourceText: name,
      normalizedValue: name,
      required: true,
      referenceKey: key,
    });
  }

  for (const name of anatomyNames) {
    const key = `anatomy_${slugPart(name)}`;
    references.push({
      referenceKey: key,
      originalText: name,
      normalizedText: name,
      role: "anatomy",
      required: true,
      relationship: "intrinsic",
      resolution: "resolved_intrinsic",
      candidateEntityIds: [],
      allowClarification: false,
    });
    claims.push({
      claimKey: key,
      claimType: "anatomy",
      sourceText: name,
      normalizedValue: name,
      required: true,
      referenceKey: key,
    });
  }

  if (durationSeconds) {
    claims.push({
      claimKey: "explicit_duration",
      claimType: "duration",
      sourceText: input.rawText,
      normalizedValue: `${durationSeconds} seconds`,
      required: true,
      durationSeconds,
    });
  }

  if (deicticLocation) {
    references.push({
      referenceKey: "current_location",
      originalText: deicticLocation,
      normalizedText: deicticLocation.toLowerCase(),
      role: "location",
      required: true,
      relationship: "current_location",
      resolution: locationId ? "resolved_entity" : "unresolved",
      ...(locationId ? { resolvedEntityId: locationId } : {}),
      candidateEntityIds: [],
      allowClarification: true,
    });
    claims.push({
      claimKey: "current_location",
      claimType: "location",
      sourceText: deicticLocation,
      normalizedValue: "current location",
      required: true,
      referenceKey: "current_location",
    });
  }

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
    references,
    claims,
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
      danger,
      timePressure: pressurePattern.test(input.rawText) ? 4 : 0,
    },
    assumptions: [...new Set(assumptions)].slice(0, 32),
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
