import { GeneratedDefinitionDraftSchema, type GeneratedDefinitionDraft } from "@nocturne/contracts";

export const INVENTION_MECHANICS_VERSION = "invention-mechanics-v1";

export const INVENTION_EFFECT_CATALOGUE = [
  { effectId: "sense", description: "Detect a signal, entity, condition, or change." },
  { effectId: "analyze", description: "Interpret information already detected or supplied." },
  { effectId: "record", description: "Preserve information for later retrieval or proof." },
  { effectId: "communicate", description: "Transmit information between entities or locations." },
  { effectId: "authenticate", description: "Verify identity, access, provenance, or permission." },
  { effectId: "conceal", description: "Reduce detectability without erasing authoritative facts." },
  { effectId: "illuminate", description: "Reveal or make a physical area easier to perceive." },
  { effectId: "protect", description: "Reduce harm, intrusion, exposure, or environmental risk." },
  { effectId: "damage", description: "Cause physical or system harm through an explicit method." },
  { effectId: "repair", description: "Restore condition or functionality." },
  { effectId: "move", description: "Move an entity, object, or material through space." },
  { effectId: "transport", description: "Carry people, objects, or resources between locations." },
  { effectId: "store", description: "Hold a resource, object, energy, or information." },
  { effectId: "manufacture", description: "Transform inputs into a defined physical output." },
  { effectId: "heat", description: "Increase temperature through a stated energy source." },
  { effectId: "cool", description: "Reduce temperature through a stated mechanism." },
  { effectId: "disrupt", description: "Interfere with another effect, system, or process." },
  {
    effectId: "amplify",
    description: "Increase the reach or magnitude of another supported effect.",
  },
  {
    effectId: "support",
    description: "Provide a bounded general advantage not covered by another verb.",
  },
] as const;

export const INVENTION_CAPACITY_RULES = [
  "capacity.space",
  "capacity.power",
  "capacity.concealment",
  "capacity.security",
  "capacity.access",
] as const;

const effectIds = new Set<string>(INVENTION_EFFECT_CATALOGUE.map((effect) => effect.effectId));
const capacityRuleIds = new Set<string>(INVENTION_CAPACITY_RULES);

const effectAliases: Record<string, string> = {
  detect: "sense",
  scan: "sense",
  observe: "sense",
  inspect: "analyze",
  identify: "analyze",
  classify: "analyze",
  log: "record",
  capture: "record",
  message: "communicate",
  transmit: "communicate",
  signal: "communicate",
  verify: "authenticate",
  unlock: "authenticate",
  hide: "conceal",
  mask: "conceal",
  light: "illuminate",
  shield: "protect",
  defend: "protect",
  attack: "damage",
  harm: "damage",
  fix: "repair",
  restore: "repair",
  propel: "move",
  carry: "transport",
  contain: "store",
  hold: "store",
  create: "manufacture",
  produce: "manufacture",
  cook: "heat",
  bake: "heat",
  freeze: "cool",
  jam: "disrupt",
  disable: "disrupt",
  boost: "amplify",
  enhance: "amplify",
};

const capacityAliases: Record<string, string> = {
  space: "capacity.space",
  power: "capacity.power",
  concealment: "capacity.concealment",
  security: "capacity.security",
  access: "capacity.access",
  "installation.space": "capacity.space",
  "installation.power": "capacity.power",
  "installation.concealment": "capacity.concealment",
  "installation.security": "capacity.security",
  "installation.access": "capacity.access",
};

type Effect = GeneratedDefinitionDraft["effects"][number];
type Requirement = GeneratedDefinitionDraft["requirements"][number];

function token(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_");
}

export function isKnownEffectId(effectId: string): boolean {
  return effectIds.has(effectId);
}

export function isKnownCapacityRuleId(ruleId: string): boolean {
  return capacityRuleIds.has(ruleId);
}

export function canonicalEffectId(effectId: string): string {
  const normalized = token(effectId);
  if (effectIds.has(normalized)) return normalized;
  return effectAliases[normalized] || "support";
}

function normalizeEffect(effect: Effect): Effect {
  const originalEffectId = effect.effectId;
  const effectId = canonicalEffectId(originalEffectId);
  return {
    ...effect,
    effectId,
    parameters:
      effectId === "support" && token(originalEffectId) !== "support"
        ? { ...effect.parameters, originalEffectId }
        : effect.parameters,
  };
}

export function normalizeGeneratedMechanics(input: GeneratedDefinitionDraft): {
  draft: GeneratedDefinitionDraft;
  warnings: string[];
} {
  const parsed = GeneratedDefinitionDraftSchema.parse(input);
  const warnings: string[] = [];
  const normalizeRequirement = (requirement: Requirement): Requirement => {
    if (requirement.phase !== "installation") return requirement;
    const originalRuleId = requirement.ruleId;
    const normalizedRuleId = capacityAliases[token(originalRuleId)] || originalRuleId;
    if (normalizedRuleId.startsWith("capacity.") && !isKnownCapacityRuleId(normalizedRuleId)) {
      warnings.push(`Unknown installation capacity rule: ${originalRuleId}`);
    }
    return { ...requirement, ruleId: normalizedRuleId };
  };

  const draft: GeneratedDefinitionDraft = {
    ...parsed,
    effects: parsed.effects.map(normalizeEffect),
    modes: parsed.modes.map((mode) => ({
      ...mode,
      effects: mode.effects.map(normalizeEffect),
      requirements: mode.requirements.map(normalizeRequirement),
    })),
    requirements: parsed.requirements.map(normalizeRequirement),
    extensionPayload: {
      ...parsed.extensionPayload,
      mechanicsCatalogueVersion: INVENTION_MECHANICS_VERSION,
      ...(warnings.length ? { mechanicsNormalizationWarnings: warnings } : {}),
    },
  };

  return { draft, warnings };
}
