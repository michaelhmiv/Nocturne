import type { PersistentActionPlan } from "../../../packages/contracts/src/action-plans.js";

const stepStatus = (status: PersistentActionPlan["steps"][number]["status"]) =>
  status.replaceAll("_", " ");

export function PersistentPlanCard({ plan }: { plan: PersistentActionPlan }) {
  return (
    <section className="persistent-plan-card" aria-label="Active action plan">
      <header className="persistent-plan-card__header">
        <strong>Active plan</strong>
        <span>{plan.status.replaceAll("_", " ")}</span>
      </header>
      <ol className="persistent-plan-card__steps">
        {plan.steps.map((step) => {
          const active = step.stepId === plan.activeStepId;
          return (
            <li
              key={step.stepId}
              className={
                active ? "persistent-plan-card__step is-active" : "persistent-plan-card__step"
              }
            >
              <div>
                <span className="persistent-plan-card__step-number">{step.order}</span>
                <span>{step.description}</span>
              </div>
              <small>{stepStatus(step.status)}</small>
              {step.waitingReason ? <p>{step.waitingReason}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
