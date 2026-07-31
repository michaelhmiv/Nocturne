type PersistentPlanStep = {
  stepId: string;
  order: number;
  kind: string;
  description: string;
  status: "pending" | "ready" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "superseded";
  waitingReason: string | null;
  outcomeGrade: string | null;
};

type PersistentPlan = {
  planId: string;
  status: string;
  activeStepId: string | null;
  steps: PersistentPlanStep[];
};

export type PersistentWorldActionResult =
  | {
      state: "waiting_for_clarification";
      requestId: string;
      prompt: string;
    }
  | {
      state: "waiting";
      requestId: string;
      plan: PersistentPlan;
      narration: string;
    }
  | {
      state: "completed";
      requestId: string;
      plan: PersistentPlan;
      narration: string;
      eventIds: string[];
    };

const label = (value: string) => value.replaceAll("_", " ");

function outcomeLabel(value: string | null) {
  if (!value) return null;
  if (value === "no_effect") return "nothing changed";
  return label(value);
}

export function persistentWorldEventIds(result: PersistentWorldActionResult) {
  return result.state === "completed" ? result.eventIds : [];
}

export default function PersistentWorldResultCard({
  text,
  result,
}: {
  text: string;
  result: PersistentWorldActionResult;
}) {
  if (result.state === "waiting_for_clarification") {
    return (
      <article className="scene-turn">
        <div className="scene-player-line">{text}</div>
        <div className="scene-event scene-event-world">
          <p className="scene-kicker">CLARIFICATION NEEDED</p>
          <p className="scene-narration">{result.prompt}</p>
        </div>
      </article>
    );
  }

  const completed = result.state === "completed";
  return (
    <article className="scene-turn scene-plan-turn">
      <div className="scene-player-line">{text}</div>
      <div className={`scene-event scene-event-${completed ? "complete_success" : "partial_success"} scene-plan-result`}>
        <div className="scene-plan-header">
          <div>
            <p className="scene-kicker">{completed ? "RESOLVED" : "IN PROGRESS"}</p>
            <h2>{completed ? "The world state was updated." : label(result.plan.status)}</h2>
          </div>
          <span className="scene-plan-state">{label(result.plan.status)}</span>
        </div>

        <ol className="scene-plan-steps" aria-label="Persistent action plan steps">
          {result.plan.steps.map((step) => (
            <li className={`scene-plan-step scene-plan-step-${step.status}`} key={step.stepId}>
              <div className="scene-plan-step-number">{step.order}</div>
              <div className="scene-plan-step-copy">
                <div className="scene-plan-step-heading">
                  <strong>{step.description}</strong>
                  <span>{outcomeLabel(step.outcomeGrade) || label(step.status)}</span>
                </div>
                {step.waitingReason ? <p>{step.waitingReason}</p> : null}
              </div>
            </li>
          ))}
        </ol>

        <p className="scene-narration">{result.narration}</p>
      </div>
    </article>
  );
}
