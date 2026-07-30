export * from "./effect-catalogue.js";
export * from "./installation.js";

import { GeneratedDefinitionDraftSchema, type GeneratedDefinitionDraft } from "@nocturne/contracts";
import { isKnownCapacityRuleId, isKnownEffectId } from "./effect-catalogue.js";

export interface ContentValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  suggestions: string[];
}

export interface ContentValidationResult {
  status: "valid" | "conditional" | "invalid";
  draft?: GeneratedDefinitionDraft;
  issues: ContentValidationIssue[];
  requiresReview: boolean;
}

export function validateGeneratedContent(input: unknown): ContentValidationResult {
  const parsed = GeneratedDefinitionDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      issues: parsed.error.issues.map((issue) => ({
        code: "schema.invalid",
        severity: "error" as const,
        message: `${issue.path.join(".") || "draft"}: ${issue.message}`,
        suggestions: [],
      })),
      requiresReview: false,
    };
  }
  const draft = parsed.data;
  const issues: ContentValidationIssue[] = [];
  const allEffects = [...draft.effects, ...draft.modes.flatMap((mode) => mode.effects)];
  const allRequirements = [
    ...draft.requirements,
    ...draft.modes.flatMap((mode) => mode.requirements),
  ];
  const peakStrength = allEffects.reduce((peak, effect) => Math.max(peak, effect.strength), 0);

  for (const effect of allEffects) {
    if (!isKnownEffectId(effect.effectId)) {
      issues.push({
        code: "mechanics.unknown_effect",
        severity: "error",
        message: `Unknown mechanical effect: ${effect.effectId}`,
        suggestions: ["Use a canonical effect from the Nocturne mechanics catalogue."],
      });
    }
  }
  for (const requirement of allRequirements) {
    if (
      requirement.phase === "installation" &&
      requirement.ruleId.startsWith("capacity.") &&
      !isKnownCapacityRuleId(requirement.ruleId)
    ) {
      issues.push({
        code: "installation.unknown_capacity",
        severity: "error",
        message: `Unknown installation capacity: ${requirement.ruleId}`,
        suggestions: [
          "Use capacity.space, capacity.power, capacity.concealment, capacity.security, or capacity.access.",
        ],
      });
    }
  }
  if (allEffects.length === 0) {
    issues.push({
      code: "mechanics.no_effects",
      severity: "warning",
      message: "The concept has no mechanical effects and will behave as descriptive content only.",
      suggestions: ["Add an effect binding if the concept should change game mechanics."],
    });
  }
  if (peakStrength >= 7) {
    if (draft.limitations.length === 0)
      issues.push({
        code: "magnitude.missing_limitation",
        severity: "error",
        message: "High-magnitude content requires at least one meaningful limitation.",
        suggestions: ["Add a limitation on range, duration, precision, targets, or activation."],
      });
    if (draft.counters.length === 0)
      issues.push({
        code: "magnitude.missing_counterplay",
        severity: "error",
        message: "High-magnitude content requires discoverable counterplay.",
        suggestions: ["Add a counter that another character can discover and use."],
      });
    if (draft.costs.length === 0 && draft.requirements.length === 0)
      issues.push({
        code: "magnitude.missing_support",
        severity: "error",
        message: "High-magnitude content requires a cost, dependency, or operational requirement.",
        suggestions: [
          "Add a resource cost, installation dependency, upkeep, or activation requirement.",
        ],
      });
    if (draft.acquisitionPath.type === "immediate")
      issues.push({
        code: "magnitude.immediate_acquisition",
        severity: "error",
        message: "High-magnitude content cannot be acquired immediately without progression.",
        suggestions: [
          "Use a staged trained, built, researched, discovered, or story-gated acquisition path.",
        ],
      });
  }
  if (
    allEffects.length > 0 &&
    draft.signatures.length === 0 &&
    draft.modes.every((mode) => mode.signatures.length === 0)
  ) {
    issues.push({
      code: "counterplay.no_signature",
      severity: "warning",
      message:
        "No generated signature is defined. Confirm that this is intentional and supported by the concept.",
      suggestions: [
        "Add a detectable signature or a limitation explaining why no signature is produced.",
      ],
    });
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  const requiresReview = draft.noveltyLevel >= 4;
  return {
    status:
      errors.length > 0 ? "invalid" : issues.length > 0 || requiresReview ? "conditional" : "valid",
    draft,
    issues,
    requiresReview,
  };
}
