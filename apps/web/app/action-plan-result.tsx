type ConsumptionResult = {
  displayName: string;
  unitsConsumed: number;
  remainingUnits: number | null;
  materialized: boolean;
  conditions: Array<{ name: string }>;
  risks: Array<{ description: string; occurred: boolean }>;
};

type TravelResult = {
  to: string;
  path: string[];
  travelSeconds: number;
  scheduled: boolean;
};

export type ActionPlanStepResult = {
  stepId: string;
  order: number;
  rawText: string;
  actionType: string;
  objective: string;
  dependsOnPreviousSuccess: boolean;
  status: "completed" | "skipped";
  outcomeGrade?: string;
  eventId?: string;
  narration?: string;
  consumption?: ConsumptionResult;
  travel?: TravelResult;
  skipReason?: string;
};

export type ActionPlanResult = {
  planId: string;
  rawText: string;
  summary: string;
  overallStatus: "complete_success" | "partial_success" | "failure" | "invalid";
  steps: ActionPlanStepResult[];
  narration: string;
  finalState: {
    locationId: string | null;
    actorStatus: string;
    pendingTravelTo: string | null;
  };
  idempotentReplay: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseActionPlanResult(value: unknown): ActionPlanResult | null {
  const candidate = object(value);
  if (
    !candidate ||
    typeof candidate.planId !== "string" ||
    typeof candidate.rawText !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.overallStatus !== "string" ||
    !Array.isArray(candidate.steps) ||
    typeof candidate.narration !== "string"
  ) {
    return null;
  }
  const finalState = object(candidate.finalState);
  if (!finalState) return null;
  return candidate as unknown as ActionPlanResult;
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function stepDetail(step: ActionPlanStepResult): string | null {
  if (step.status === "skipped") return step.skipReason || "Skipped because a prerequisite failed.";
  if (step.consumption) {
    const remaining =
      step.consumption.remainingUnits === null
        ? "Remaining quantity is unknown."
        : `${step.consumption.remainingUnits} remaining.`;
    return `Consumed ${step.consumption.unitsConsumed} ${step.consumption.displayName}. ${remaining}`;
  }
  if (step.travel) {
    return step.travel.scheduled
      ? `Travel started. ETA ${step.travel.travelSeconds} seconds.`
      : `Travel completed in ${step.travel.travelSeconds} seconds.`;
  }
  return step.outcomeGrade ? label(step.outcomeGrade) : null;
}

export default function ActionPlanResultCard({ result }: { result: ActionPlanResult }) {
  return (
    <article className="scene-turn scene-plan-turn">
      <div className="scene-player-line">{result.rawText}</div>
      <div className={`scene-event scene-event-${result.overallStatus} scene-plan-result`}>
        <div className="scene-plan-header">
          <div>
            <p className="scene-kicker">{label(result.overallStatus)}</p>
            <h2>{result.summary}</h2>
          </div>
          <span className="scene-plan-state">{result.finalState.actorStatus}</span>
        </div>

        <ol className="scene-plan-steps" aria-label="Resolved action steps">
          {result.steps.map((step) => {
            const detail = stepDetail(step);
            return (
              <li className={`scene-plan-step scene-plan-step-${step.status}`} key={step.stepId}>
                <div className="scene-plan-step-number">{step.order}</div>
                <div className="scene-plan-step-copy">
                  <div className="scene-plan-step-heading">
                    <strong>{step.objective}</strong>
                    <span>{step.status === "skipped" ? "skipped" : label(step.outcomeGrade || "resolved")}</span>
                  </div>
                  {detail && <p>{detail}</p>}
                  {step.consumption?.conditions.length ? (
                    <p className="scene-consequence">
                      Conditions: {step.consumption.conditions.map((condition) => condition.name).join(", ")}
                    </p>
                  ) : null}
                  {step.consumption?.risks.some((risk) => risk.occurred) ? (
                    <p className="scene-consequence">
                      Consequences: {step.consumption.risks.filter((risk) => risk.occurred).map((risk) => risk.description).join(", ")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {result.finalState.pendingTravelTo && (
          <p className="scene-consequence">Travel remains in progress. The current location will change only when the scheduled move resolves.</p>
        )}

        <details className="scene-plan-narrative">
          <summary>Narrative</summary>
          <p className="scene-narration">{result.narration}</p>
        </details>
      </div>
    </article>
  );
}
