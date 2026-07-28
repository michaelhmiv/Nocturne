import {
  GeneratedDefinitionDraftSchema,
  type GeneratedDefinitionDraft,
} from "@nocturne/contracts";

export interface ContentValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
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
      })),
      requiresReview: false,
    };
  }

  const draft = parsed.data;
  const issues: ContentValidationIssue[] = [];
  const allEffects = [...draft.effects, ...draft.modes.flatMap((mode) => mode.effects)];
  const peakStrength = allEffects.reduce((peak, effect) => Math.max(peak, effect.strength), 0);

  if (allEffects.length === 0) {
    issues.push({
      code: "mechanics.no_effects",
      severity: "warning",
      message: "The concept has no mechanical effects and will behave as descriptive content only.",
    });
  }

  if (peakStrength >= 7) {
    if (draft.limitations.length === 0) {
      issues.push({
        code: "magnitude.missing_limitation",
        severity: "error",
        message: "High-magnitude content requires at least one meaningful limitation.",
      });
    }
    if (draft.counters.length === 0) {
      issues.push({
        code: "magnitude.missing_counterplay",
        severity: "error",
        message: "High-magnitude content requires discoverable counterplay.",
      });
    }
    if (draft.costs.length === 0 && draft.requirements.length === 0) {
      issues.push({
        code: "magnitude.missing_support",
        severity: "error",
        message: "High-magnitude content requires a cost, dependency, or operational requirement.",
      });
    }
  }

  if (allEffects.length > 0 && draft.signatures.length === 0 && draft.modes.every((mode) => mode.signatures.length === 0)) {
    issues.push({
      code: "counterplay.no_signature",
      severity: "warning",
      message: "No generated signature is defined. Confirm that this is intentional and supported by the concept.",
    });
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const requiresReview = draft.noveltyLevel >= 4;

  return {
    status: errors.length > 0 ? "invalid" : issues.length > 0 || requiresReview ? "conditional" : "valid",
    draft,
    issues,
    requiresReview,
  };
}
