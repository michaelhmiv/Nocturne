import type { GeneratedDefinitionDraft, InstallationEvaluation } from "@nocturne/contracts";

const supportedCapacities = ["space", "power", "concealment", "security", "access"] as const;
type Capacity = (typeof supportedCapacities)[number];

function readRequiredCapacities(draft: GeneratedDefinitionDraft): Record<string, number> {
  const required: Record<string, number> = {};
  for (const requirement of [
    ...draft.requirements,
    ...draft.modes.flatMap((mode) => mode.requirements),
  ]) {
    if (requirement.phase !== "installation") continue;
    const match = /^capacity\.(space|power|concealment|security|access)$/.exec(requirement.ruleId);
    const capacity = match?.[1];
    if (!capacity) continue;
    const minimum = Number(requirement.parameters.minimum ?? requirement.parameters.tier ?? 0);
    if (Number.isFinite(minimum) && minimum >= 0) {
      required[capacity] = Math.max(required[capacity] ?? 0, minimum);
    }
  }
  const extension = draft.extensionPayload.installationRequirements;
  if (extension && typeof extension === "object" && !Array.isArray(extension)) {
    for (const capacity of supportedCapacities) {
      const value = Number((extension as Record<string, unknown>)[capacity] ?? 0);
      if (Number.isFinite(value) && value >= 0)
        required[capacity] = Math.max(required[capacity] ?? 0, value);
    }
  }
  return required;
}

export function evaluateInstallation(
  draft: GeneratedDefinitionDraft,
  available: Record<string, number>,
): InstallationEvaluation {
  const required = readRequiredCapacities(draft);
  const issues: InstallationEvaluation["issues"] = [];
  for (const [capacity, minimum] of Object.entries(required)) {
    const amount = Number(available[capacity] ?? 0);
    if (amount < minimum) {
      issues.push({
        capacity,
        required: minimum,
        available: amount,
        message: `Installation requires ${capacity} ${minimum}, but the location provides ${amount}.`,
      });
    }
  }
  const warnings: string[] = [];
  if (Object.keys(required).length === 0) {
    warnings.push("The normalized definition declares no installation-capacity requirements.");
  }
  if (!draft.signatures.length && draft.modes.every((mode) => mode.signatures.length === 0)) {
    warnings.push(
      "The installation produces no declared signature; confirm that this is intentional.",
    );
  }
  return { fits: issues.length === 0, required, available, issues, warnings };
}

export function supportedInstallationCapacities(): readonly Capacity[] {
  return supportedCapacities;
}
