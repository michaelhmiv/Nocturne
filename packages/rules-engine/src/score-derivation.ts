import type { GeneratedDefinitionDraft, ResolutionModifier } from "@nocturne/contracts";

export interface DetectionContext {
  method: {
    instanceId: string;
    condition: number;
    draft: GeneratedDefinitionDraft;
    installed: boolean;
  };
  environment: { clutter: number; darkness: number; coverageSupport: number };
  opposition: { concealment: number; countermeasure: number };
  operator: { competence: number };
  proposedModifiers: ResolutionModifier[];
}

export interface DerivedContest {
  actorScore: number;
  targetScore: number;
  modifiers: ResolutionModifier[];
  trace: string[];
}

export function deriveDetectionContest(context: DetectionContext): DerivedContest {
  const effects = [
    ...context.method.draft.effects,
    ...context.method.draft.modes.flatMap((mode) => mode.effects),
  ];
  const sensorStrength = effects.reduce((peak, effect) => Math.max(peak, effect.strength || 0), 0);
  if (sensorStrength <= 0) throw new Error("Selected method has no detection-compatible effect.");
  const conditionModifier = Math.max(
    -2,
    Math.min(2, Math.floor((context.method.condition - 50) / 25)),
  );
  const installationSupport = context.method.installed ? 1 : -3;
  const actorScore =
    sensorStrength +
    conditionModifier +
    installationSupport +
    context.operator.competence +
    context.environment.coverageSupport;
  const targetScore =
    context.opposition.concealment +
    context.opposition.countermeasure +
    context.environment.clutter +
    Math.max(0, context.environment.darkness - 1);
  return {
    actorScore,
    targetScore,
    modifiers: context.proposedModifiers,
    trace: [
      `sensor_strength=${sensorStrength}`,
      `condition_modifier=${conditionModifier}`,
      `installation_support=${installationSupport}`,
      `operator_competence=${context.operator.competence}`,
      `coverage_support=${context.environment.coverageSupport}`,
      `opposition_concealment=${context.opposition.concealment}`,
      `opposition_countermeasure=${context.opposition.countermeasure}`,
      `environment_clutter=${context.environment.clutter}`,
      `environment_darkness=${context.environment.darkness}`,
    ],
  };
}
