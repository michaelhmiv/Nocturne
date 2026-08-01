import type { AffordanceAssessment, AffordanceAssessmentRequest } from "@nocturne/contracts";
import type { AiProviderClient } from "./ai-provider.js";
import { assessEnvironmentalAffordances } from "./affordance-adjudicator.js";

export type AffordanceShadowResult =
  | { state: "disabled" }
  | { state: "completed"; assessment: AffordanceAssessment }
  | { state: "failed"; error: string };

export async function runAffordanceShadowAssessment(input: {
  enabled: boolean;
  client: Pick<AiProviderClient, "generateStructured">;
  request: AffordanceAssessmentRequest;
  record?(result: AffordanceShadowResult): void | Promise<void>;
}): Promise<AffordanceShadowResult> {
  if (!input.enabled) {
    const result: AffordanceShadowResult = { state: "disabled" };
    await input.record?.(result);
    return result;
  }
  try {
    const assessment = await assessEnvironmentalAffordances(input.client, input.request);
    const result: AffordanceShadowResult = {
      state: "completed",
      assessment: assessment.data,
    };
    await input.record?.(result);
    return result;
  } catch (error) {
    const result: AffordanceShadowResult = {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await input.record?.(result);
    return result;
  }
}
