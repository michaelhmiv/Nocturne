declare module "@nocturne/rules-engine" {
  export interface ConsumptionMechanicsResult {
    outcomeGrade:
      | "complete_success"
      | "success_with_consequence"
      | "partial_success"
      | "failure_with_progress"
      | "failure"
      | "catastrophic_reversal";
    resourceDeltas: Array<{
      resource: string;
      delta: number;
      rationale: string;
    }>;
    conditions: Array<{
      name: string;
      key: string;
      intensity: number;
      durationSeconds: number;
      rationale: string;
    }>;
    risks: Array<{ description: string; occurred: boolean }>;
    calculationTrace: string[];
  }
}
